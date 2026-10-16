'use strict';
// Node --require preload for composition fixtures (BL-0077).
//
// runCampaignComposition's default effect admission now refuses when the input
// carries no repository authority (gitCwd/repo) and no preEffectAdmit adapter,
// instead of admitting. Fixtures that exercise composition logic with in-memory
// adapters make that admission an explicit adapter here. A call that supplies
// its own adapter or repository authority is passed through untouched, so the
// real default is still what those fixtures get. The refusal itself is tested in
// controller-helper-fail-closed.test.sh.
const Module = require('module');

const origLoad = Module._load;
let patched = false;

Module._load = function load(request, parent, isMain) {
  const loaded = origLoad.apply(this, arguments);
  if (!patched
      && typeof request === 'string'
      && /(^|[\\/])campaign-composition(\.js)?$/.test(request)
      && loaded
      && typeof loaded.runCampaignComposition === 'function') {
    patched = true;
    const real = loaded.runCampaignComposition;
    loaded.runCampaignComposition = function runWithExplicitAdmission(input, adapters, ...rest) {
      const inp = input || {};
      const ad = adapters || {};
      if (typeof ad.preEffectAdmit === 'function'
          || (typeof inp.gitCwd === 'string' && inp.gitCwd)
          || (typeof inp.repo === 'string' && inp.repo)) {
        return real.call(this, input, adapters, ...rest);
      }
      return real.call(this, input, { ...ad, preEffectAdmit: () => ({ ok: true }) }, ...rest);
    };
  }
  return loaded;
};
