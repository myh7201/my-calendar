/* Calendar v40: account-scoped caches and a durable, per-document outbox. */
(function (root) {
  'use strict';
  const raw = root.localStorage;
  const dataKeys = new Set([
    'calendar_categories_v1', 'calendar_active_cats_v1', 'calendar_events_v1',
    'calendar_tasks_v1', 'calendar_notes_v1', 'calendar_folders_v1',
    'calendar_event_counter_v1', 'calendar_reminded_v1', 'calendar_widget_selected_date'
  ]);
  const collectionKeys = {events: 'calendar_events_v1', tasks: 'calendar_tasks_v1', notes: 'calendar_notes_v1'};
  const prefix = 'calendar_v40:';
  const legacyKey = prefix + 'legacy-backup';
  let scope = 'guest', uid = null, writer = null, run = null, retry = null, lastError = '';
  function key(name, owner = scope) { return prefix + owner + ':' + name; }
  function parse(value, fallback) { try { return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function token() { return Date.now().toString(36) + '-' + (root.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)); }
  function entries(owner = scope) {
    const start = key('op:', owner), list = [];
    for (let i = 0; i < raw.length; i++) {
      const k = raw.key(i);
      if (k && k.startsWith(start)) {
        const value = parse(raw.getItem(k), null);
        if (value && value.uid && value.collection && value.id) list.push([k, value]);
      }
    }
    return list;
  }
  function emit() {
    root.dispatchEvent?.(new CustomEvent('calendarSyncStatus', {detail: {pending: entries().length, error: lastError}}));
  }
  // Old caches have no owner. Preserve them before removing the shared keys;
  // they can only be imported by an explicit recovery action after login.
  try { if (!raw.getItem(prefix + 'legacy-migrated')) {
    const backup = {};
    for (const name of dataKeys) { const value = raw.getItem(name); if (value !== null) backup[name] = value; }
    if (Object.keys(backup).length && !raw.getItem(legacyKey)) raw.setItem(legacyKey, JSON.stringify({createdAt: Date.now(), values: backup}));
    for (const name of dataKeys) raw.removeItem(name);
    raw.setItem(prefix + 'legacy-migrated', '1');
  }} catch (error) {
    // A nearly full store may not have room for a duplicate backup. Leave the
    // original shared keys untouched and quarantined; never block app startup.
    console.warn('Legacy backup deferred; original local data retained', error);
  }
  const storage = {
    getItem(name) { return raw.getItem(dataKeys.has(name) ? key(name) : name); },
    setItem(name, value) { raw.setItem(dataKeys.has(name) ? key(name) : name, String(value)); },
    removeItem(name) { raw.removeItem(dataKeys.has(name) ? key(name) : name); },
    getScope() { return scope; },
    useAccount(nextUid) {
      uid = nextUid || null; scope = uid ? 'user:' + encodeURIComponent(uid) : 'guest';
      writer = null; run = null; lastError = ''; clearTimeout(retry); retry = null; emit();
    }
  };
  function operationKey(collection, id, owner = scope) { return key('op:' + collection + ':' + encodeURIComponent(String(id)), owner); }
  function enqueue(collection, id, data, remove = false) {
    if (!uid) return;
    const opKey = operationKey(collection, id);
    const next = {uid, collection, id: String(id), remove, data: remove ? null : clone(data)};
    const old = parse(raw.getItem(opKey), null);
    if (old && JSON.stringify({...old, rev: null}) === JSON.stringify({...next, rev: null})) return;
    raw.setItem(opKey, JSON.stringify({...next, rev: token()}));
  }
  function schedule() { emit(); Promise.resolve().then(flush).catch(() => {}); }
  function queuePut(collection, item) {
    if (!uid) return Promise.resolve({queued: false});
    if (!item || !item.id) return Promise.reject(new Error('缺少資料 ID'));
    enqueue(collection, item.id, item);
    const cacheKey = collectionKeys[collection];
    if (cacheKey) {
      const list = parse(storage.getItem(cacheKey), []).filter(x => String(x.id) !== String(item.id));
      list.push(clone(item)); storage.setItem(cacheKey, JSON.stringify(list));
    }
    schedule(); return Promise.resolve({queued: true});
  }
  function queueDelete(collection, id) {
    if (!uid) return Promise.resolve({queued: false});
    enqueue(collection, id, null, true);
    const cacheKey = collectionKeys[collection];
    if (cacheKey) storage.setItem(cacheKey, JSON.stringify(parse(storage.getItem(cacheKey), []).filter(x => String(x.id) !== String(id))));
    schedule(); return Promise.resolve({queued: true});
  }
  function saveCollection(collection, items) {
    const cacheKey = collectionKeys[collection];
    if (!cacheKey || !Array.isArray(items)) throw new Error('資料格式錯誤');
    const previous = new Map(parse(storage.getItem(cacheKey), []).map(x => [String(x.id), x]));
    const next = new Map(items.map(x => [String(x.id), x]));
    // Record intent before updating the cache, so a process exit cannot lose it.
    for (const [id, item] of next) if (JSON.stringify(previous.get(id)) !== JSON.stringify(item)) enqueue(collection, id, item);
    for (const id of previous.keys()) if (!next.has(id)) enqueue(collection, id, null, true);
    storage.setItem(cacheKey, JSON.stringify(items)); schedule();
  }
  function queueSettings(collection, data, expectedUid = uid) {
    if (!uid || uid !== expectedUid) return Promise.reject(new Error('帳號已切換'));
    enqueue(collection, uid, data); schedule(); return Promise.resolve({queued: true});
  }
  function overlay(collection, cloudItems, fromCache = false) {
    const cacheKey = collectionKeys[collection];
    const result = new Map((fromCache && cacheKey ? parse(storage.getItem(cacheKey), []) : []).map(x => [String(x.id), x]));
    for (const item of cloudItems) result.set(String(item.id), item);
    for (const [, op] of entries()) if (op.collection === collection) {
      if (op.remove) result.delete(op.id); else result.set(op.id, clone(op.data));
    }
    return Array.from(result.values());
  }
  function pendingSettings(collection, data = {}) {
    const op = parse(raw.getItem(operationKey(collection, uid)), null);
    return op && !op.remove ? {...data, ...clone(op.data)} : data;
  }
  async function flush() {
    if (!uid || !writer || root.navigator?.onLine === false) return;
    if (run) return run;
    const owner = scope, currentUid = uid, send = writer;
    const work = async () => {
      while (uid === currentUid && scope === owner) {
        const batch = entries(owner);
        if (!batch.length || root.navigator?.onLine === false) break;
        for (const [opKey, op] of batch) {
          if (uid !== currentUid || scope !== owner) return;
          // Another tab may have edited or already acknowledged this document.
          if (parse(raw.getItem(opKey), null)?.rev !== op.rev) continue;
          await send(clone(op));
          // An acknowledgement must never clear a newer local edit.
          if (parse(raw.getItem(opKey), null)?.rev === op.rev) raw.removeItem(opKey);
          if (uid === currentUid) { lastError = ''; emit(); }
        }
      }
    };
    const task = Promise.resolve().then(() => root.navigator?.locks?.request ? root.navigator.locks.request(prefix + 'sync:' + currentUid, work) : work())
      .catch(error => {
        if (uid === currentUid) {
          lastError = String(error.message || error); emit();
          clearTimeout(retry); retry = setTimeout(() => { retry = null; flush(); }, 15000);
        }
      }).finally(() => { if (run === task) run = null; if (uid !== currentUid) schedule(); });
    run = task; return task;
  }
  function recoveryValues(source) {
    if (source === 'legacy') {
      const saved = parse(raw.getItem(legacyKey), {})?.values;
      if (saved) return saved;
      const original = {};
      for (const name of dataKeys) { const value = raw.getItem(name); if (value !== null) original[name] = value; }
      return original;
    }
    const values = {};
    for (const name of dataKeys) { const value = raw.getItem(key(name, 'guest')); if (value !== null) values[name] = value; }
    return values;
  }
  function hasRecovery(source) {
    if (raw.getItem(prefix + 'recovered:' + source)) return false;
    const values = recoveryValues(source);
    return Object.values(collectionKeys).some(k => parse(values[k], []).length > 0);
  }
  function recoveryData(source) { return clone(recoveryValues(source)); }
  root.calendarStorage = storage;
  root.CalendarData = {
    saveCollection, queuePut, queueDelete, queueSettings, overlay, pendingSettings,
    pending(collection) { return entries().filter(([, op]) => !collection || op.collection === collection).length; },
    connect(send) { writer = send; schedule(); }, flush, hasRecovery, recoveryData,
    markRecovered(source) { raw.setItem(prefix + 'recovered:' + source, JSON.stringify({uid,at:Date.now()})); },
    get uid() { return uid; }, get error() { return lastError; }
  };
  root.addEventListener?.('online', () => flush());
  root.addEventListener?.('storage', event => {
    if (event.key?.startsWith(key('op:'))) { emit(); flush(); }
  });
})(window);
