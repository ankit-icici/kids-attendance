/**
 * Kids Attendance — family code keeper (Google Apps Script web app)
 * =================================================================
 * Lets a phone that lost everything (Chrome "clear site data", a new phone)
 * get back to the shared Firebase space with a 4-digit family code instead of
 * the database address + space code, which nobody remembers.
 *
 * Why a script and not Firebase alone: a 4-digit code is only safe if wrong
 * guesses are capped, and Firebase Realtime Database rules cannot rate-limit.
 * This script can: every 5 wrong codes in a row → 15-minute wait; 10 → refused
 * until a phone that is already connected sets the code again (or the owner
 * runs resetLock() in the editor). A stranger gets at most 10 guesses of 10,000.
 *
 * What it stores (Script Properties, private to the owner's Google account —
 * never in this repo): the database address, the space code, and a salted
 * SHA-256 hash of the 4-digit code.
 *
 * Deploy: script.google.com → New project → paste → Deploy → New deployment →
 * Web app, Execute as: Me, Who has access: Anyone. Put the /exec URL in
 * KEY_URL in index.html. Re-deploy as "New version" after edits.
 *
 * Actions (POST, text/plain JSON body):
 *   status  {code}                → {pinSet}  (true only if a code is set FOR this space)
 *   setPin  {pin, dbUrl, code}    → {ok}      allowed when no code is set yet, or when
 *                                             the caller proves access by sending the
 *                                             same space code that is stored
 *   recover {pin}                 → {dbUrl, code}  with the guess cap
 */
var SOFT_LIMIT = 5, HARD_LIMIT = 10, WAIT_MS = 15 * 60 * 1000;
var VERSION = '1.0.0';

function doGet() { return out({ ok: true, version: VERSION }); }

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'Bad request' }); }
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();       // parallel guesses can't race the counter
  lock.waitLock(20000);
  try {
    var p = props.getProperties();
    if (req.action === 'status') {
      return out({ ok: true, pinSet: !!(p.HASH && p.CODE && p.CODE === String(req.code || '')) });
    }
    if (req.action === 'setPin') {
      var pin = String(req.pin || ''), code = String(req.code || ''), dbUrl = String(req.dbUrl || '');
      if (!/^\d{4}$/.test(pin)) return out({ ok: false, error: 'The code must be 4 digits' });
      if (!code || !/^https:\/\/[a-z0-9.-]+\.(firebasedatabase\.app|firebaseio\.com)$/.test(dbUrl))
        return out({ ok: false, error: 'Sharing details missing' });
      if (p.HASH && p.CODE !== code) return out({ ok: false, error: 'A family code already belongs to another space' });
      var salt = Utilities.getUuid();
      props.setProperties({ SALT: salt, HASH: hash(salt, pin), CODE: code, DBURL: dbUrl, FAILS: '0', UNTIL: '0' });
      return out({ ok: true });
    }
    if (req.action === 'recover') {
      if (!p.HASH) return out({ ok: false, code: 'NO_PIN', error: 'No family code has been set yet' });
      var fails = Number(p.FAILS || 0), until = Number(p.UNTIL || 0);
      if (fails >= HARD_LIMIT) return out({ ok: false, code: 'LOCKED', error: 'Locked after too many wrong codes' });
      if (Date.now() < until) return out({ ok: false, code: 'WAIT', until: until, error: 'Too many wrong codes' });
      if (/^\d{4}$/.test(String(req.pin || '')) && hash(p.SALT, String(req.pin)) === p.HASH) {
        props.setProperties({ FAILS: '0', UNTIL: '0' });
        return out({ ok: true, dbUrl: p.DBURL, code: p.CODE });
      }
      fails++;
      props.setProperty('FAILS', String(fails));
      if (fails >= HARD_LIMIT) return out({ ok: false, code: 'LOCKED', error: 'Locked after too many wrong codes' });
      if (fails % SOFT_LIMIT === 0) {
        props.setProperty('UNTIL', String(Date.now() + WAIT_MS));
        return out({ ok: false, code: 'WAIT', until: Date.now() + WAIT_MS, error: 'Too many wrong codes' });
      }
      return out({ ok: false, code: 'WRONG', left: SOFT_LIMIT - (fails % SOFT_LIMIT), error: 'Wrong code' });
    }
    return out({ ok: false, error: 'Unknown action' });
  } finally { lock.releaseLock(); }
}

function hash(salt, pin) {
  return Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8));
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Run from the editor: lifts a lock-out, keeps the code.
function resetLock() { PropertiesService.getScriptProperties().setProperties({ FAILS: '0', UNTIL: '0' }); }
// Run from the editor: forgets everything; a connected phone can then set a new code.
function forgetAll() { PropertiesService.getScriptProperties().deleteAllProperties(); }
