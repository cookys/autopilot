'use strict';
function checkPool(manifest, poolId) {
  if (!manifest || !Array.isArray(manifest.pool_whitelist) || manifest.pool_whitelist.length === 0) return {ok:false,reason:'empty_whitelist'};
  if (typeof poolId !== 'string' || !poolId.trim()) return {ok:false,reason:'missing_pool'};
  if (!manifest.pool_whitelist.includes(poolId)) return {ok:false,reason:'pool_not_allowed'};
  return {ok:true};
}
module.exports = { checkPool };
