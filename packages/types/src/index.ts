// Public re-exports for @devdock/types.
//
// These DTOs mirror the Rust types in `crates/library/src/entities.rs` and the
// DTOs in `crates/application/src/dto.rs`. Manual mirror during phase 1;
// phase 2 may introduce ts-rs or similar for automatic generation.

export * from './library';
export * from './clipboard';
export * from './ssh';
export * from './settings';
export * from './common';

export const VERSION = '0.1.0';
