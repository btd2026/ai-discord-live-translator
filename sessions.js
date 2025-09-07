// sessions.js - minimal per-user speaker registry shared across modules

class Sessions {
  constructor() {
    this.map = new Map(); // userId -> { username, avatar, pinnedInputLang, detectedLang, isSpeaking, lastHeardAt }
  }

  ensure(userId) {
    if (!this.map.has(userId)) this.map.set(userId, { userId });
    return this.map.get(userId);
  }

  get(userId) { return this.map.get(userId); }

  setLang(userId, lang) {
    const s = this.ensure(userId);
    s.pinnedInputLang = typeof lang === 'string' ? lang.trim() : undefined;
    return s;
  }

  setUsername(userId, username) {
    const s = this.ensure(userId);
    if (username) s.username = username;
    return s;
  }

  setAvatar(userId, avatarUrl) {
    const s = this.ensure(userId);
    if (avatarUrl) s.avatar = String(avatarUrl);
    return s;
  }

  setSpeaking(userId, speaking) {
    const s = this.ensure(userId);
    s.isSpeaking = Boolean(speaking);
    s.lastHeardAt = Date.now();
    return s;
  }

  setDetectedLang(userId, lang) {
    const s = this.ensure(userId);
    s.detectedLang = typeof lang === 'string' ? lang.trim() : undefined;
    return s;
  }

  touch(userId) {
    const s = this.ensure(userId);
    s.lastHeardAt = Date.now();
    return s;
  }

  getAllSpeakers() {
    return Array.from(this.map.values()).map(s => ({
      userId: s.userId,
      username: s.username,
      avatar: s.avatar,
      pinnedInputLang: s.pinnedInputLang,
      detectedLang: s.detectedLang,
      isSpeaking: Boolean(s.isSpeaking),
      lastHeardAt: s.lastHeardAt || 0
    }));
  }
}

// Export a singleton to keep state shared
const sessions = new Sessions();
module.exports = { Sessions, sessions };
