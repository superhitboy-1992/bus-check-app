import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS, DATA_VERSION } from './constants';

const DRAFT_KEY = 'busCheck.draft';
const INSPECTORS_KEY = 'busCheck.inspectors';
const INSPECTORS_MAX = 20;
const STORAGE_WARN_BYTES = 4 * 1024 * 1024; // 4MB

function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBasicData(b) {
  const src = b && typeof b === 'object' ? b : {};
  return {
    routes: Array.isArray(src.routes) ? src.routes : [],
    drivers: Array.isArray(src.drivers) ? src.drivers : [],
    conductors: Array.isArray(src.conductors) ? src.conductors : [],
    stations: Array.isArray(src.stations) ? src.stations : [],
  };
}

function load() {
  let records = [];
  let basicData = { routes: [], drivers: [], conductors: [], stations: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.records);
    const parsed = raw ? JSON.parse(raw) : [];
    records = Array.isArray(parsed) ? parsed : [];
  } catch {
    records = [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.basicData);
    basicData = normalizeBasicData(raw ? JSON.parse(raw) : {});
  } catch {
    basicData = { routes: [], drivers: [], conductors: [], stations: [] };
  }
  return { records, basicData };
}

let state = load();

const listeners = new Set();
const pressureListeners = new Set();
let lastDeleted = null;
let pressureState = {
  overLimit: computeStorageUsageBytes().total > STORAGE_WARN_BYTES,
  quotaFailed: false,
};

function computeStorageUsageBytes() {
  let records = 0;
  let basicData = 0;
  try {
    records = new Blob([localStorage.getItem(STORAGE_KEYS.records) || '[]']).size;
  } catch {
    records = 0;
  }
  try {
    basicData = new Blob([localStorage.getItem(STORAGE_KEYS.basicData) || '{}']).size;
  } catch {
    basicData = 0;
  }
  return { records, basicData, total: records + basicData };
}

function setPressure(next) {
  if (pressureState.overLimit === next.overLimit && pressureState.quotaFailed === next.quotaFailed) {
    return;
  }
  pressureState = next;
  pressureListeners.forEach((fn) => fn());
}

function subscribePressure(fn) {
  pressureListeners.add(fn);
  return () => pressureListeners.delete(fn);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(state.records));
    localStorage.setItem(STORAGE_KEYS.basicData, JSON.stringify(state.basicData));
    localStorage.setItem(STORAGE_KEYS.version, String(DATA_VERSION));
    setPressure({ overLimit: computeStorageUsageBytes().total > STORAGE_WARN_BYTES, quotaFailed: false });
  } catch (e) {
    console.error('保存数据失败', e);
    setPressure({
      overLimit: pressureState.overLimit,
      quotaFailed: Boolean(e && (e.name === 'QuotaExceededError' || e.code === 22)),
    });
  }
}

function emit() {
  save();
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.records || e.key === STORAGE_KEYS.basicData || e.key === STORAGE_KEYS.version) {
      state = load();
      emit();
    }
  });
}

export function useRecords() {
  return useSyncExternalStore(subscribe, () => state.records);
}

export function useBasicData() {
  return useSyncExternalStore(subscribe, () => state.basicData);
}

export function useStoragePressure() {
  return useSyncExternalStore(subscribePressure, () => pressureState);
}

export function getStorageUsageBytes() {
  return computeStorageUsageBytes();
}

export function getBasicData() {
  return state.basicData;
}

export function getRecords() {
  return state.records;
}

export function createRecord(data) {
  const now = new Date().toISOString();
  const record = { id: uid(), ...data, createdAt: now, updatedAt: now };
  state = { ...state, records: [record, ...state.records] };
  emit();
  return record;
}

export function updateRecord(id, data) {
  state = {
    ...state,
    records: state.records.map((r) => (r.id === id ? { ...r, ...data, updatedAt: new Date().toISOString() } : r)),
  };
  emit();
}

export function deleteRecord(id) {
  const target = state.records.find((r) => r.id === id);
  if (target) lastDeleted = { ...target };
  state = { ...state, records: state.records.filter((r) => r.id !== id) };
  emit();
}

export function restoreLastDeleted() {
  if (!lastDeleted) return null;
  const restored = lastDeleted;
  lastDeleted = null;
  state = { ...state, records: [restored, ...state.records] };
  emit();
  return restored;
}

export function hasLastDeleted() {
  return Boolean(lastDeleted);
}

export function getDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(payload) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error('保存草稿失败', e);
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    console.error('清除草稿失败', e);
  }
}

function loadInspectors() {
  try {
    const raw = localStorage.getItem(INSPECTORS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && n.trim()) : [];
  } catch {
    return [];
  }
}

export function getInspectorHistory() {
  return loadInspectors();
}

export function addInspector(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return;
  const list = [n, ...loadInspectors().filter((x) => x !== n)].slice(0, INSPECTORS_MAX);
  try {
    localStorage.setItem(INSPECTORS_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('保存检查人历史失败', e);
  }
}

export function addBasicItem(type, item) {
  const listKey = `${type}s`;
  const next = { id: uid(), ...item };
  state = { ...state, basicData: { ...state.basicData, [listKey]: [...state.basicData[listKey], next] } };
  emit();
  return next;
}

export function updateBasicItem(type, id, patch) {
  const listKey = `${type}s`;
  state = {
    ...state,
    basicData: {
      ...state.basicData,
      [listKey]: state.basicData[listKey].map((it) => (it.id === id ? { ...it, ...patch } : it)),
    },
  };
  emit();
}

export function deleteBasicItem(type, id) {
  const listKey = `${type}s`;
  state = {
    ...state,
    basicData: { ...state.basicData, [listKey]: state.basicData[listKey].filter((it) => it.id !== id) },
  };
  emit();
}

export function swapStations(i, j, routeName) {
  const stations = state.basicData.stations.filter((s) => s.routeName === routeName);
  if (i < 0 || j < 0 || i >= stations.length || j >= stations.length) return;
  const a = stations[i];
  const b = stations[j];
  updateBasicItem('station', a.id, { sortOrder: b.sortOrder });
  updateBasicItem('station', b.id, { sortOrder: a.sortOrder });
}

export function replaceAllData({ records, basicData }) {
  state = {
    records: Array.isArray(records) ? records : [],
    basicData: normalizeBasicData(basicData),
  };
  emit();
}

export function buildBackupPayload() {
  return {
    app: '公交跳车检查助手',
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    records: state.records,
    basicData: state.basicData,
  };
}
