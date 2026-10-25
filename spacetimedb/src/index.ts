// Entry point: only reducers/views (+ default schema) may be exported from here.
import { spacetimedb } from './schema';

export * from './reducers/admin';
export * from './reducers/account';
export * from './reducers/pairs';
export * from './reducers/presets';
export * from './reducers/signals';
export * from './reducers/nudges';
export * from './reducers/delivery';
export * from './reducers/coordination';
export * from './reducers/preferences';
export * from './reducers/expiry';
export * from './reducers/discovery';
export * from './reducers/introductions';
export * from './reducers/events';
export * from './reducers/pause';
export * from './reducers/standing';
export * from './reducers/suggestions';
export * from './views';
export default spacetimedb;
