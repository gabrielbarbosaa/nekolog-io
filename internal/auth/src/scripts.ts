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

export const VERIFY_OTP = `
local d = redis.call('HMGET', KEYS[1], 'challenge', 'code')
if not d[1] or d[1] ~= ARGV[1] then return 0 end
if d[2] == ARGV[2] then redis.call('DEL', KEYS[1]) return 1 end
if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1]) return -2
end
return -1
`.trim()
