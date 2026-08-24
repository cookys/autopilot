# Negative scope fixture — deliberate blind spot

This scanner has ZERO coverage of unstructured identifiers. The following
lines contain real classes of leak that this scanner will NOT catch, on
purpose — they are the human reviewer's job, not this scanner's:

- A bare hostname with no dotted TLD suffix this scanner recognizes: gizmo-node-7
- A client/company name mentioned in prose: Acme Rockets Inc.
- A tmux pane address: agy-session-3:2.1

If a future change makes this scanner start flagging any of the above, this
fixture (and the test that asserts silence on it) must go red — that is the
point: it forces an explicit decision to update the prose promising the human
gate is the only defense against unstructured identifiers, rather than letting
detection coverage silently expand.
