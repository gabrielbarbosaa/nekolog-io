export const ISSUE_OTP = `
if not redis.call('SET', KEYS[2], 1, 'NX', 'EX', ARGV[4]) then return -1 end
local sends = redis.call('INCR', KEYS[3])
if sends == 1 then redis.call('EXPIRE', KEYS[3], ARGV[6]) end
if sends > tonumber(ARGV[5]) then return -2 end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'challenge', ARGV[1], 'code', ARGV[2], 'attempts', 0)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`.trim()

export const COUNT_ATTEMPT = `
local failures = redis.call('INCR', KEYS[1])
if failures == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return failures
`.trim()

export const CREATE_SESSION = `
redis.call('HSET', KEYS[1], 'cur', ARGV[1], 'prev', '', 'prevUntil', '0',
  'absExp', ARGV[2], 'lastUsed', ARGV[3], 'userId', ARGV[4],
  'device', ARGV[5], 'country', ARGV[6], 'createdAt', ARGV[3],
  'remember', ARGV[10])
redis.call('EXPIRE', KEYS[1], ARGV[7])
redis.call('SADD', KEYS[2], ARGV[8])
redis.call('EXPIRE', KEYS[2], ARGV[9])
return 1
`.trim()

export const ROTATE_REFRESH = `
local s = redis.call('HMGET', KEYS[1], 'cur', 'prev', 'prevUntil', 'absExp', 'userId', 'remember')
if not s[1] then return {0, '', ''} end

local who = s[5] or ''
local remembered = s[6] or ''

if ARGV[1] == s[1] then
  local ttl = math.min(tonumber(ARGV[5]), math.floor((tonumber(s[4]) - tonumber(ARGV[3])) / 1000))
  if ttl <= 0 then redis.call('DEL', KEYS[1]) return {0, '', ''} end
  redis.call('HSET', KEYS[1], 'cur', ARGV[2], 'prev', s[1], 'prevUntil', ARGV[4], 'lastUsed', ARGV[3])
  redis.call('EXPIRE', KEYS[1], ttl)
  return {1, who, remembered}
end

if ARGV[1] == s[2] then
  if tonumber(ARGV[3]) <= tonumber(s[3]) then return {2, who, remembered} end
  redis.call('DEL', KEYS[1]) return {-1, who, ''}
end

return {0, '', ''}
`.trim()

export const REVOKE_SESSION = `
local owner = redis.call('HGET', KEYS[1], 'userId')
redis.call('DEL', KEYS[1])
if owner then redis.call('SREM', 'sess:user:' .. owner, ARGV[1]) end
return 1
`.trim()

export const REVOKE_EVERY_SESSION = `
local sids = redis.call('SMEMBERS', KEYS[1])
for _, sid in ipairs(sids) do redis.call('DEL', 'sess:' .. sid) end
redis.call('DEL', KEYS[1])
return #sids
`.trim()

export const VERIFY_OTP = `
local d = redis.call('HMGET', KEYS[1], 'challenge', 'code')
if not d[1] or d[1] ~= ARGV[1] then return 0 end
if d[2] == ARGV[2] then redis.call('DEL', KEYS[1]) return 1 end
if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1]) return -2
end
return -1
`.trim()
