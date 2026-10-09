/**
 * 웹 푸시(VAPID) 발송. Apps Script에는 ECDSA가 없어서 P-256 ES256 서명을 BigInt로 직접 구현한다.
 * 페이로드 없는 푸시만 보낸다(암호화 불필요). 알림 내용은 서비스워커가 받은 뒤 API(digest)에서 가져온다.
 * Node에서도 동작하도록 순수 함수로 작성하고, 바이트 처리(해시·난수·base64)만 주입받는다.
 */

var P256 = (function () {
  var P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
  var N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  var A = P - BigInt(3);
  var G = [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
           BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')];
  var ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), THREE = BigInt(3);

  function mod(a, m) { var r = a % m; return r < ZERO ? r + m : r; }
  function inv(a, m) { // 확장 유클리드
    var lm = ONE, hm = ZERO, low = mod(a, m), high = m;
    while (low > ONE) { var r = high / low; var nm = hm - lm * r, nw = high - low * r; hm = lm; lm = nm; high = low; low = nw; }
    return mod(lm, m);
  }
  function add(p1, p2) {
    if (!p1) return p2; if (!p2) return p1;
    var l;
    if (p1[0] === p2[0]) {
      if (mod(p1[1] + p2[1], P) === ZERO) return null;
      l = mod((THREE * p1[0] * p1[0] + A) * inv(TWO * p1[1], P), P);
    } else {
      l = mod((p2[1] - p1[1]) * inv(p2[0] - p1[0], P), P);
    }
    var x = mod(l * l - p1[0] - p2[0], P);
    return [x, mod(l * (p1[0] - x) - p1[1], P)];
  }
  function mul(k, pt) {
    var r = null, q = pt;
    while (k > ZERO) { if (k & ONE) r = add(r, q); q = add(q, q); k >>= ONE; }
    return r;
  }
  function toBig(bytes) { var h = '0x'; for (var i = 0; i < bytes.length; i++) h += ((bytes[i] & 255) + 256).toString(16).slice(1); return BigInt(h); }
  function toBytes(v, len) { var h = v.toString(16); while (h.length < len * 2) h = '0' + h; var out = []; for (var i = 0; i < len; i++) out.push(parseInt(h.substr(i * 2, 2), 16)); return out; }

  return {
    N: N,
    /** 개인키 d(BigInt) → 비압축 공개키 65바이트 */
    publicKey: function (d) { var q = mul(d, G); return [4].concat(toBytes(q[0], 32), toBytes(q[1], 32)); },
    /** 난수 바이트 → 유효한 개인키 */
    keyFromRandom: function (bytes) { return mod(toBig(bytes), N - ONE) + ONE; },
    /** ES256 서명(r||s 64바이트). hash = SHA-256(msg) 바이트, rnd = 32바이트 이상 난수 */
    sign: function (hash, d, rnd) {
      var e = toBig(hash), k, r, s;
      for (var i = 0; ; i++) {
        k = mod(toBig(rnd) + BigInt(i), N - ONE) + ONE;
        r = mod(mul(k, G)[0], N); if (r === ZERO) continue;
        s = mod(inv(k, N) * (e + r * d), N); if (s === ZERO) continue;
        return toBytes(r, 32).concat(toBytes(s, 32));
      }
    },
    toBytes: toBytes,
    toBig: toBig
  };
})();

/**
 * VAPID Authorization 헤더 값을 만든다.
 * io = { sha256(string) → bytes, random(n) → bytes, b64url(bytes|string) → string }
 */
function vapidHeader(endpoint, privHex, pubB64, subject, nowSec, io) {
  var aud = endpoint.match(/^https?:\/\/[^/]+/)[0];
  var header = io.b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  var claims = io.b64url(JSON.stringify({ aud: aud, exp: nowSec + 12 * 3600, sub: subject }));
  var unsigned = header + '.' + claims;
  var sig = P256.sign(io.sha256(unsigned), BigInt('0x' + privHex), io.random(32));
  return 'vapid t=' + unsigned + '.' + io.b64url(sig) + ', k=' + pubB64;
}

if (typeof module !== 'undefined') module.exports = { P256: P256, vapidHeader: vapidHeader };
