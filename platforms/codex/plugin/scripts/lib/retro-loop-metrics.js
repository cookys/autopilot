'use strict';

const DISPATCH_KEYS = [
  'impl_dispatch',
  'review_dispatch',
  'codex_exec',
  'grok_dispatch',
  'agy_dispatch',
  'explore',
  'author',
  'engine_implement_review',
];
const MAX_EVIDENCE_REFS = 50;

function eventOrder(left, right) {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.MAX_SAFE_INTEGER;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) return leftTime - rightTime;
  if (left.session_id !== right.session_id) {
    return left.session_id.localeCompare(right.session_id);
  }
  return left.evidence.line - right.evidence.line;
}

function evidenceRef(event) {
  return {
    session_id: event.evidence.session_id,
    timestamp: event.evidence.timestamp,
    event_class: event.evidence.event_class,
    line: event.evidence.line,
  };
}

function known(value, events = []) {
  return {
    status: 'known',
    value,
    reason: null,
    evidence: events.slice(0, MAX_EVIDENCE_REFS).map(evidenceRef),
    evidence_truncated: events.length > MAX_EVIDENCE_REFS,
  };
}

function evidenceReason(evidence) {
  return evidence && evidence.status === 'incomplete'
    ? `incomplete_evidence:${evidence.reasons.join(',')}`
    : null;
}

function unknown(reason) {
  return {
    status: 'unknown',
    value: null,
    reason,
    evidence: [],
    evidence_truncated: false,
  };
}

function noEvidence(reason, evidence) {
  const incomplete = evidenceReason(evidence);
  return unknown(incomplete ? `${reason};${incomplete}` : reason);
}

function observed(value, events, evidence) {
  const metric = known(value, events);
  const incomplete = evidenceReason(evidence);
  if (!incomplete) return metric;
  if (value === 0) return unknown(`${incomplete};observed_zero_not_authoritative`);
  return {
    ...metric,
    status: 'incomplete',
    reason: incomplete,
  };
}

function aggregateTranscript(sessions) {
  const result = {
    sessions: sessions.length,
    total_tool_calls: 0,
    bash_calls: 0,
    agent_calls: 0,
    impl_dispatch: 0,
    review_dispatch: 0,
    codex_exec: 0,
    grok_dispatch: 0,
    agy_dispatch: 0,
    explore: 0,
    author: 0,
    engine_implement_review: 0,
  };
  for (const session of sessions) {
    for (const event of session.events) {
      if (event.event_class !== 'tool_call' && event.event_class !== 'lifecycle') continue;
      result.total_tool_calls += 1;
      if (event.tool && ['Bash', 'exec_command'].includes(event.tool.name)) result.bash_calls += 1;
      if (event.tool && ['Agent', 'spawn_agent'].includes(event.tool.name)) result.agent_calls += 1;
      const kind = event.control && event.control.dispatch_kind;
      if (kind && DISPATCH_KEYS.includes(kind)) result[kind] += 1;
    }
  }
  return result;
}

function worktreeMetric(events, evidence) {
  const lifecycle = events
    .filter((event) => ['worktree_create', 'worktree_remove'].includes(event.category)
      && event.control && event.control.owned === true)
    .sort(eventOrder);
  if (lifecycle.length === 0) {
    return {
      created: noEvidence('no_owned_worktree_lifecycle_evidence', evidence),
      removed: noEvidence('no_owned_worktree_lifecycle_evidence', evidence),
      high_water_mark: noEvidence('no_owned_worktree_lifecycle_evidence', evidence),
    };
  }
  const active = new Set();
  let highWater = 0;
  let invalid = false;
  for (const event of lifecycle) {
    const id = event.control && event.control.lifecycle_fingerprint;
    if (!id) {
      invalid = true;
      continue;
    }
    if (event.category === 'worktree_create') {
      if (active.has(id)) invalid = true;
      active.add(id);
      highWater = Math.max(highWater, active.size);
    } else if (!active.delete(id)) {
      invalid = true;
    }
  }
  const creates = lifecycle.filter((event) => event.category === 'worktree_create');
  const removes = lifecycle.filter((event) => event.category === 'worktree_remove');
  return {
    created: observed(creates.length, creates, evidence),
    removed: observed(removes.length, removes, evidence),
    high_water_mark: invalid || active.size > 0
      ? noEvidence(
        invalid ? 'unpaired_or_duplicate_lifecycle_event' : 'owned_worktree_not_removed',
        evidence,
      )
      : observed(highWater, lifecycle, evidence),
  };
}

function transitionMetric(events, evidence) {
  const transitions = events
    .filter((event) => event.event_class === 'state_transition'
      && event.control && event.control.state)
    .sort(eventOrder);
  let sawCodeReady = false;
  for (const codeReady of transitions) {
    if (codeReady.control.state !== 'code_ready' || !codeReady.timestamp) continue;
    sawCodeReady = true;
    const binding = codeReady.control.ticket_fingerprint
      ? `ticket:${codeReady.control.ticket_fingerprint}`
      : `session:${codeReady.session_id}`;
    const mergeReady = transitions.find((event) => {
      const candidateBinding = event.control.ticket_fingerprint
        ? `ticket:${event.control.ticket_fingerprint}`
        : `session:${event.session_id}`;
      return event.control.state === 'merge_ready'
        && event.timestamp
        && candidateBinding === binding
        && Date.parse(event.timestamp) >= Date.parse(codeReady.timestamp);
    });
    if (mergeReady) {
      return observed(
        Date.parse(mergeReady.timestamp) - Date.parse(codeReady.timestamp),
        [codeReady, mergeReady],
        evidence,
      );
    }
  }
  return noEvidence(
    sawCodeReady ? 'missing_bound_merge_ready_transition' : 'missing_code_ready_transition',
    evidence,
  );
}

function matchingProviderResult(result, dispatches) {
  const callId = result.tool && result.tool.call_id;
  if (!callId) return false;
  return dispatches.some((dispatch) => {
    if (dispatch.harness !== result.harness
        || dispatch.session_id !== result.session_id
        || !dispatch.tool
        || dispatch.tool.call_id !== callId) return false;
    const left = dispatch.control || {};
    const right = result.control || {};
    for (const key of ['provider', 'ticket_fingerprint', 'generation']) {
      if (left[key] !== null && left[key] !== undefined
          && right[key] !== null && right[key] !== undefined
          && left[key] !== right[key]) return false;
    }
    return true;
  });
}

function computeLoopMetrics(sessions, evidence = { status: 'complete', reasons: [] }) {
  const events = sessions.flatMap((session) => session.events).sort(eventOrder);
  const dispatches = events.filter((event) => event.category === 'provider_dispatch');
  const providerDispatchBindings = sessions.flatMap(
    (session) => session.providerDispatchBindings || session.events,
  ).filter((event) => event.category === 'provider_dispatch');
  const dispatchResults = events.filter((event) => event.category === 'provider_result');
  const boundDispatchResults = dispatchResults.filter(
    (event) => matchingProviderResult(event, providerDispatchBindings),
  );
  const transportFailures = boundDispatchResults.filter(
    (event) => event.signals.includes('transport_failure'),
  );

  const rerouteEvents = [];
  const lastProvider = new Map();
  for (const event of dispatches) {
    const control = event.control || {};
    if (!control.ticket_fingerprint || !control.provider) continue;
    const previous = lastProvider.get(control.ticket_fingerprint);
    if (previous && previous !== control.provider) rerouteEvents.push(event);
    lastProvider.set(control.ticket_fingerprint, control.provider);
  }

  const ticketEvents = events.filter((event) => (
    event.control && event.control.ticket_fingerprint
  ));
  const tickets = new Set(ticketEvents.map((event) => event.control.ticket_fingerprint));
  const generationEvents = ticketEvents.filter((event) => Number.isInteger(event.control.generation));
  const generations = new Map();
  for (const event of generationEvents) {
    const ticket = event.control.ticket_fingerprint;
    if (!generations.has(ticket)) generations.set(ticket, new Set());
    generations.get(ticket).add(event.control.generation);
  }
  let continuations = 0;
  let generationCount = 0;
  for (const values of generations.values()) {
    generationCount += values.size;
    continuations += Math.max(0, values.size - 1);
  }

  const userMessages = events.filter((event) => (
    event.event_class === 'message' && event.actor === 'user'
  ));
  const corrections = userMessages.filter((event) => event.signals.includes('user_correction'));
  const reversals = userMessages.filter((event) => event.signals.includes('status_reversal'));

  return {
    evidence_completeness: evidence,
    deterministic: {
      evidence_class: 'deterministic',
      provider_dispatches: dispatches.length > 0
        ? observed(dispatches.length, dispatches, evidence)
        : noEvidence('no_provider_dispatch_evidence', evidence),
      provider_dispatch_results: dispatchResults.length > 0
        ? observed(dispatchResults.length, dispatchResults, evidence)
        : noEvidence('no_provider_result_evidence', evidence),
      provider_reroutes: dispatches.some((event) => (
        event.control && event.control.ticket_fingerprint && event.control.provider
      ))
        ? observed(rerouteEvents.length, rerouteEvents, evidence)
        : noEvidence('missing_ticket_or_provider_binding', evidence),
      transport_failures: boundDispatchResults.length > 0
        ? observed(transportFailures.length, transportFailures, evidence)
        : noEvidence('no_bound_provider_result_evidence', evidence),
      controller_tickets: tickets.size > 0
        ? observed(tickets.size, ticketEvents, evidence)
        : noEvidence('no_controller_ticket_evidence', evidence),
      ticket_continuations: generations.size > 0
        ? observed(continuations, generationEvents, evidence)
        : noEvidence('no_ticket_generation_evidence', evidence),
      review_generations: generations.size > 0
        ? observed(generationCount, generationEvents, evidence)
        : noEvidence('no_ticket_generation_evidence', evidence),
      worktrees: worktreeMetric(events, evidence),
      code_ready_to_merge_ready_ms: transitionMetric(events, evidence),
    },
    heuristic: {
      evidence_class: 'heuristic',
      user_corrections: userMessages.length > 0
        ? observed(corrections.length, corrections, evidence)
        : noEvidence('no_user_message_evidence', evidence),
      status_reversals: userMessages.length > 0
        ? observed(reversals.length, reversals, evidence)
        : noEvidence('no_user_message_evidence', evidence),
    },
  };
}

function dispatchTotal(transcript) {
  return DISPATCH_KEYS.reduce((total, key) => total + transcript[key], 0);
}

module.exports = {
  aggregateTranscript,
  computeLoopMetrics,
  dispatchTotal,
  evidenceRef,
};
