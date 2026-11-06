import { hash } from './domain.js';

export function rateStore(db){
  let windowMs;
  return {
    localKeys:false,
    init(options){windowMs=options.windowMs;},
    async increment(key){
      const stamp=Date.now();
      const row=await db.prepare('INSERT INTO auth_rate_limits(key,hits,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_rate_limits.reset_at<=? THEN 1 ELSE auth_rate_limits.hits+1 END,reset_at=CASE WHEN auth_rate_limits.reset_at<=? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END RETURNING hits,reset_at').get(hash(key),stamp+windowMs,stamp,stamp);
      return {totalHits:row.hits,resetTime:new Date(Number(row.reset_at))};
    },
    async decrement(key){await db.prepare('UPDATE auth_rate_limits SET hits=GREATEST(hits-1,0) WHERE key=?').run(hash(key));},
    async resetKey(key){await db.prepare('DELETE FROM auth_rate_limits WHERE key=?').run(hash(key));}
  };
}
