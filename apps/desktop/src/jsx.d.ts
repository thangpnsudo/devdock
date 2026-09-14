// Ambient declarations for React 19 + TypeScript 5.6+.
//
// React 19 moved the JSX namespace into React (i.e., `React.JSX`) instead of
// the global scope. The existing codebase (and several third-party types we
// depend on) still use the legacy bare `JSX.Element` reference. Re-exporting
// the JSX namespace globally keeps the existing code compiling without
// requiring every file to import JSX explicitly.

import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementClass = ReactJSX.ElementClass;
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
    type IntrinsicAttributes = ReactJSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = ReactJSX.IntrinsicClassAttributes<T>;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}
