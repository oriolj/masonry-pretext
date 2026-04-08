// Type definitions for masonry-pretext
//
// Hand-written stub. Not exhaustive — covers the surface that consumers
// actually call (constructor, instance methods, options object). The Item
// type is intentionally opaque; users rarely need to type its internals.
//
// Generated to satisfy `package.json` `"types"` field. Hand-curated rather
// than generated from source because the source is JS with JSDoc-light
// comments — manual is faster than wiring up TypeScript-from-JS extraction
// for a 250-LOC file.
//
// See README.md for usage examples and FORK_ROADMAP.md § 2.7 for the
// long-term plan to keep this in sync with the source.

export interface MasonrySize {
  /**
   * Width including margins, padding, and border. The only width field
   * masonry reads from a callback-provided size.
   */
  outerWidth: number;
  /**
   * Height including margins, padding, and border. The only height field
   * masonry reads from a callback-provided size.
   */
  outerHeight: number;
}

/**
 * Opaque internal Item wrapper. Each `.item` element gets one. Users
 * generally do not need to read its fields directly.
 */
export interface MasonryItem {
  element: Element;
  size: Partial<MasonrySize> & Record<string, number | boolean | undefined>;
  position: { x: number; y: number };
}

export interface MasonryOptions {
  /**
   * CSS selector for items inside the grid container. Items not matching
   * this selector are ignored.
   */
  itemSelector?: string;

  /**
   * Width of one column. Number = pixels. String = CSS selector for an
   * element to measure (e.g. `.grid-sizer`). Element = the element to
   * measure directly.
   */
  columnWidth?: number | string | Element;

  /**
   * Horizontal gap between columns, in pixels (or selector / element).
   */
  gutter?: number | string | Element;

  /**
   * Set the container's width to the used column count. Useful for
   * centering the grid inside its parent. Default `false`.
   */
  fitWidth?: boolean;

  /**
   * Place items in DOM order across columns instead of always picking the
   * shortest column. Default `false`.
   */
  horizontalOrder?: boolean;

  /**
   * Position items as percentages of container width instead of pixels.
   * Default `false`.
   */
  percentPosition?: boolean;

  /**
   * Selector / element / array of elements to mark as "stamps" — fixed
   * positions that other items flow around.
   */
  stamp?: string | Element | Element[];

  /**
   * Layout origin. Default left + top. Setting to false flips horizontally
   * or vertically respectively.
   */
  originLeft?: boolean;
  originTop?: boolean;

  /**
   * Auto-relayout on window resize. Default `true`.
   */
  resize?: boolean;

  /**
   * Auto-resize the container to fit the laid-out items. Default `true`.
   */
  resizeContainer?: boolean;

  /**
   * Run `layout()` immediately on construction. Default `true`.
   */
  initLayout?: boolean;

  /**
   * Skip transitions on the first layout. Default `true` (the
   * `_isLayoutInited` flag manages this internally).
   */
  layoutInstant?: boolean;

  /**
   * CSS transition duration for animated relayouts. Set to `0` (or `'0'`)
   * to disable transitions entirely. Default `'0.4s'`.
   */
  transitionDuration?: string | number;

  /**
   * Stagger transition delays for sequential animations, in milliseconds.
   * Default `0`.
   */
  stagger?: number;

  /**
   * **SSR / static-content preset.** Enable for server-rendered grids
   * whose items will not change size after first paint. Turning this on
   * does three things in one flag:
   *
   *   1. Forces `transitionDuration: 0` — no animated settle on any
   *      relayout (including the ones triggered by window resize).
   *   2. Skips the `document.fonts.ready` deferred layout (#010). Safe
   *      because static SSR content is measured in its final font.
   *   3. Skips per-item `ResizeObserver` construction (#012). Safe
   *      because items don't grow — no lazy images, no dynamic text.
   *
   * Default `false`. Set to `true` in Next.js / Astro / SvelteKit SSR
   * pages to eliminate the hydration flash and the runtime cost of the
   * dynamic-content machinery. See the README "Server-side rendering
   * (SSR) and hydration" section.
   *
   * @see https://github.com/oriolj/masonry-pretext/blob/master/improvements/015-static-ssr-preset.md
   */
  static?: boolean;

  /**
   * **`masonry-pretext` headline feature.** If set and returns a size,
   * that size is used as `item.size` and `item.getSize()` (which forces
   * a DOM reflow) is skipped entirely. Designed for use with
   * `@chenglou/pretext` or any other DOM-free measurement strategy.
   *
   * The returned size only needs `outerWidth` and `outerHeight` —
   * those are the only fields masonry reads from it.
   *
   * The lookup must be **O(1)** for the bench to show a speedup; an
   * O(N) lookup per item erases the savings.
   *
   * @see https://github.com/oriolj/masonry-pretext/blob/master/improvements/009-pretext-integration.md
   */
  pretextify?(element: Element): MasonrySize | null | undefined | false;

  // ----- Legacy compat aliases (mapped via Outlayer.compatOptions) -----
  // These are the upstream upstream-v3-era names. They still work because
  // the upstream qunit tests use them. Prefer the un-`is`-prefixed names
  // above for new code.
  isFitWidth?: boolean;
  isOriginLeft?: boolean;
  isOriginTop?: boolean;
  isResizeBound?: boolean;
  isResizingContainer?: boolean;
  isInitLayout?: boolean;
  isLayoutInstant?: boolean;
  isHorizontal?: boolean;
}

export default class Masonry {
  constructor(element: Element | string, options?: MasonryOptions);

  /** All items currently in the grid. */
  items: MasonryItem[];

  /** Number of columns the grid is currently laid out in. */
  cols: number;

  /** Computed column width (after `_getMeasurement`). */
  columnWidth: number;

  /** The container element this Masonry instance was constructed with. */
  element: Element;

  /** Run a full relayout. */
  layout(): void;

  /** Re-collect items from the container's children. */
  reloadItems(): void;

  /** Newly-appended elements: add to items + layout the new ones. */
  appended(elements: Element | Element[] | NodeListOf<Element>): void;

  /** Newly-prepended elements: add to the beginning + relayout. */
  prepended(elements: Element | Element[] | NodeListOf<Element>): void;

  /** Add elements as stamps (fixed positions other items flow around). */
  stamp(elements: Element | Element[] | NodeListOf<Element> | string): void;

  /** Remove stamp elements. */
  unstamp(elements: Element | Element[] | NodeListOf<Element> | string): void;

  /** Remove items from the grid AND from the DOM. */
  remove(elements: Element | Element[] | NodeListOf<Element>): void;

  /** Look up the Item wrapper for a given element. */
  getItem(elem: Element): MasonryItem | undefined;

  /** Look up Item wrappers for multiple elements. */
  getItems(elems: Element[] | NodeListOf<Element>): MasonryItem[];

  /** Tear down the instance: clean up styles, listeners, internal state. */
  destroy(): void;

  /** Subscribe to a masonry event (`'layoutComplete'`, `'removeComplete'`). */
  on(eventName: string, listener: (...args: unknown[]) => void): this;

  /** Unsubscribe from a masonry event. */
  off(eventName: string, listener: (...args: unknown[]) => void): this;

  /** Subscribe once. */
  once(eventName: string, listener: (...args: unknown[]) => void): this;

  // ----- Static -----

  /** Look up the Masonry instance attached to a given element. */
  static data(elem: Element | string): Masonry | undefined;
}
