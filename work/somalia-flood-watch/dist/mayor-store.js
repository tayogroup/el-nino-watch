/* City manager workflow is private to this browser. It does not verify public reports. */
(function (root) {
  'use strict';
  const KEY = 'somalia-city-manager-v1';
  const ACTION_LIMIT = 200;
  const REVIEW_LIMIT = 1000;
  const MAX_BYTES = 8 * 1024 * 1024;
  const actionStatuses = new Set(['todo', 'in-progress', 'blocked', 'done']);
  const priorities = new Set(['low', 'normal', 'high']);
  const reviewStatuses = new Set(['unreviewed', 'checking', 'checked', 'escalated']);
  const reserved = new Set(['__proto__', 'constructor', 'prototype']);
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const supported = new Set((Array.isArray(root.SOMALIA_CITIES) ? root.SOMALIA_CITIES : []).map(city => String(Array.isArray(city) ? city[0] : city?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean));
  // Retired locations remain in saved records; they never become replacement-city actions.
  const storedCities = new Set([...supported, 'badhan', 'zeila', 'wanlaweyn', 'eyl']);
  let state = {schema: 1, cities: Object.create(null)};
  let storage = null;
  let persisted = false;
  let storageError = null;
  let sequence = 0;

  function fail(message) { throw new Error(message); }
  function object(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
    for (const key in value) if (!owns(value, key)) fail(`${label} cannot contain inherited fields.`);
    for (const key of Object.keys(value)) if (reserved.has(key) || !fields.includes(key)) fail(`${label} contains an unsupported field.`);
    return value;
  }
  function cityId(value) {
    if (typeof value !== 'string') fail('Choose a supported city.');
    const id = value.trim().toLowerCase();
    if (!supported.has(id)) fail('Choose a supported city.');
    return id;
  }
  function text(value, label, limit, optional = false) {
    if (optional && (value === undefined || value === null || value === '')) return '';
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail(`${label} must be plain text without control characters.`);
    const result = value.trim();
    if ((!optional && !result) || result.length > limit) fail(`${label} must contain ${optional ? 'at most' : '1 to'} ${limit} characters.`);
    return result;
  }
  function dueDate(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) fail('Due date must be a valid YYYY-MM-DD date.');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('Due date must be a valid YYYY-MM-DD date.');
    return value;
  }
  function choice(value, allowed, label) {
    if (typeof value !== 'string' || !allowed.has(value)) fail(`Choose a valid ${label}.`);
    return value;
  }
  function recordId(value, label = 'Record ID') {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value) || reserved.has(value)) fail(`${label} is invalid.`);
    return value;
  }
  function timestamp(value) {
    if (typeof value !== 'string') fail('Saved timestamp is invalid.');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail('Saved timestamp is invalid.');
    return value;
  }
  const now = () => new Date().toISOString();
  function bucket(id) { return state.cities[id] || (state.cities[id] = {actions: [], reviews: []}); }
  function reviewCount() { return Object.values(state.cities).reduce((sum, city) => sum + city.reviews.length, 0); }
  function hasActionId(id) { return Object.values(state.cities).some(city => city.actions.some(action => action.id === id)); }
  function newId() {
    try {
      if (typeof root.crypto?.randomUUID === 'function') {
        const value = recordId(root.crypto.randomUUID());
        if (!hasActionId(value)) return value;
      }
    } catch (_) { /* A local monotonic fallback remains available. */ }
    let id;
    do { id = `local-${Date.now().toString(36)}-${(++sequence).toString(36)}`; } while (hasActionId(id));
    return id;
  }
  function persist() {
    try {
      if (!storage) storage = root.localStorage;
      if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') fail('Browser storage is unavailable.');
      const encoded = JSON.stringify(state);
      storage.setItem(KEY, encoded);
      if (storage.getItem(KEY) !== encoded) fail('Browser storage did not save these changes.');
      persisted = true;
      storageError = null;
    } catch (_) {
      persisted = false;
      storageError = 'Browser storage is unavailable or full. Dashboard changes are kept in memory and may be lost when this page closes.';
    }
  }
  function decode(saved) {
    if (typeof saved !== 'string' || saved.length > MAX_BYTES) fail('Saved dashboard data is too large.');
    const parsed = object(JSON.parse(saved), ['schema', 'cities'], 'Saved dashboard');
    if (parsed.schema !== 1) fail('Saved dashboard version is unsupported.');
    object(parsed.cities, [...storedCities], 'Saved cities');
    const clean = {schema: 1, cities: Object.create(null)};
    const ids = new Set();
    let totalReviews = 0;
    for (const [id, value] of Object.entries(parsed.cities)) {
      if (!storedCities.has(id)) fail('Saved city is unsupported.');
      object(value, ['actions', 'reviews'], 'Saved city');
      if (!Array.isArray(value.actions) || value.actions.length > ACTION_LIMIT || !Array.isArray(value.reviews)) fail('Saved dashboard entries are invalid.');
      totalReviews += value.reviews.length;
      if (totalReviews > REVIEW_LIMIT) fail('Saved dashboard contains too many reviews.');
      const reviewIds = new Set();
      const actions = value.actions.map(action => {
        object(action, ['id', 'cityId', 'title', 'owner', 'dueDate', 'priority', 'status', 'createdAt', 'updatedAt'], 'Saved action');
        const actionId = recordId(action.id);
        if (ids.has(actionId) || action.cityId !== id) fail('Saved action identity is invalid.');
        ids.add(actionId);
        const createdAt = timestamp(action.createdAt);
        const updatedAt = timestamp(action.updatedAt);
        if (updatedAt < createdAt) fail('Saved action timestamps are invalid.');
        return {id: actionId, cityId: id, title: text(action.title, 'Action', 160), owner: text(action.owner, 'Owner', 100, true), dueDate: dueDate(action.dueDate), priority: choice(action.priority, priorities, 'priority'), status: choice(action.status, actionStatuses, 'action status'), createdAt, updatedAt};
      });
      const reviews = value.reviews.map(review => {
        object(review, ['reportId', 'status', 'updatedAt'], 'Saved report review');
        const reportId = recordId(review.reportId, 'Report ID');
        if (reviewIds.has(reportId)) fail('Saved review identity is duplicated.');
        reviewIds.add(reportId);
        return {reportId, status: choice(review.status, reviewStatuses, 'review status'), updatedAt: timestamp(review.updatedAt)};
      });
      clean.cities[id] = {actions, reviews};
    }
    return clean;
  }
  try {
    storage = root.localStorage;
    if (!storage || typeof storage.getItem !== 'function') fail('Browser storage is unavailable.');
    const saved = storage.getItem(KEY);
    if (saved !== null) {
      try { state = decode(saved); }
      catch (_) {
        storageError = 'Saved dashboard data is invalid and was ignored. Add a new action to start fresh on this device.';
      }
    }
    if (!storageError) persist();
  } catch (_) {
    storageError = 'Browser storage is unavailable. Dashboard changes are kept in memory and may be lost when this page closes.';
  }

  root.CityManagerStore = Object.freeze({
    list(city) {
      const id = cityId(city);
      return (state.cities[id]?.actions || []).map(action => ({...action}));
    },
    add(city, input) {
      const id = cityId(city);
      object(input, ['title', 'owner', 'dueDate', 'priority'], 'Action');
      const fields = {title: text(input.title, 'Action', 160), owner: text(input.owner, 'Owner', 100, true), dueDate: dueDate(input.dueDate), priority: choice(owns(input, 'priority') ? input.priority : 'normal', priorities, 'priority')};
      if ((state.cities[id]?.actions.length || 0) >= ACTION_LIMIT) fail(`This city has reached its ${ACTION_LIMIT}-action limit. Remove completed actions to add more.`);
      const time = now();
      const action = {id: newId(), cityId: id, ...fields, status: 'todo', createdAt: time, updatedAt: time};
      bucket(id).actions.unshift(action);
      persist();
      return {...action};
    },
    update(city, actionId, patch) {
      const id = cityId(city);
      recordId(actionId);
      object(patch, ['title', 'owner', 'dueDate', 'priority', 'status'], 'Action update');
      const action = state.cities[id]?.actions.find(item => item.id === actionId);
      if (!action) fail('This action was not found in the selected city.');
      const next = {...action};
      if (owns(patch, 'title')) next.title = text(patch.title, 'Action', 160);
      if (owns(patch, 'owner')) next.owner = text(patch.owner, 'Owner', 100, true);
      if (owns(patch, 'dueDate')) next.dueDate = dueDate(patch.dueDate);
      if (owns(patch, 'priority')) next.priority = choice(patch.priority, priorities, 'priority');
      if (owns(patch, 'status')) next.status = choice(patch.status, actionStatuses, 'action status');
      next.updatedAt = now();
      Object.assign(action, next);
      persist();
      return {...action};
    },
    remove(city, actionId) {
      const id = cityId(city);
      recordId(actionId);
      const actions = state.cities[id]?.actions;
      const index = actions?.findIndex(action => action.id === actionId) ?? -1;
      if (index < 0) return false;
      actions.splice(index, 1);
      persist();
      return true;
    },
    review(city, reportId, status) {
      const id = cityId(city);
      recordId(reportId, 'Report ID');
      choice(status, reviewStatuses, 'review status');
      const existing = state.cities[id]?.reviews.find(review => review.reportId === reportId);
      if (!existing && reviewCount() >= REVIEW_LIMIT) fail(`This device has reached its ${REVIEW_LIMIT}-review limit.`);
      const value = {reportId, status, updatedAt: now()};
      if (existing) Object.assign(existing, value); else bucket(id).reviews.push(value);
      persist();
      return {...value};
    },
    reviewStatus(city, reportId) {
      const id = cityId(city);
      recordId(reportId, 'Report ID');
      return state.cities[id]?.reviews.find(review => review.reportId === reportId)?.status || 'unreviewed';
    },
    storageStatus() { return {persisted, error: storageError}; }
  });
})(window);
