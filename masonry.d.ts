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
  size: MasonrySize;
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
   * **Auto-relayout on direct DOM mutations.** When enabled, masonry
   * watches the grid container for child additions/removals via
   * `MutationObserver` and automatically calls `reloadItems()` +
   * `layout()` when items are added or removed via direct DOM
   * manipulation (`grid.appendChild`, `child.remove()`, etc.).
   *
   * Removes the "I called `grid.appendChild` and the new item didn't
   * show up" footgun. Without this option, users must remember to
   * call `msnry.appended(elem)` / `msnry.prepended(elem)` /
   * `msnry.remove(elem)` after every DOM change.
   *
   * Coalesces via `requestAnimationFrame` so multiple appends in the
   * same task collapse to a single layout call. Cleaned up
   * automatically on `destroy()`. Skipped in `static: true` mode.
   *
   * Default `false` to preserve byte budget for users who already
   * call the explicit API correctly.
   *
   * @see https://github.com/oriolj/masonry-pretext/blob/master/improvements/031-mutation-observer-auto-relayout.md
   */
  observeMutations?: boolean;

  /**
   * **Custom column-pick strategy.** Takes the array of Y values for
   * each valid horizontal position (one entry per "place where this
   * item could fit"), returns the index of the chosen position. If
   * unset, masonry picks the leftmost-shortest column (the default
   * since the original library).
   *
   * Strategies enabled by overriding this:
   *
   *   - **Rightmost shortest** (use `<=` instead of `<` in the loop):
   *     ```ts
   *     pickColumn(colGroup) {
   *       let min = colGroup[0], idx = 0;
   *       for (let i = 1; i < colGroup.length; i++) {
   *         if (colGroup[i] <= min) { min = colGroup[i]; idx = i; }
   *       }
   *       return idx;
   *     }
   *     ```
   *
   *   - **Round-robin** (closure over a counter):
   *     ```ts
   *     let counter = 0;
   *     const pickColumn = (colGroup) => counter++ % colGroup.length;
   *     ```
   *
   *   - **Random**:
   *     ```ts
   *     pickColumn: (colGroup) => Math.floor(Math.random() * colGroup.length)
   *     ```
   *
   * Closes upstream `desandro/masonry#811`. Also accepted by
   * `Masonry.computeLayout` for SSR / pure-Node usage.
   *
   * @see https://github.com/oriolj/masonry-pretext/blob/master/improvements/032-column-pick-strategy.md
   */
  pickColumn?: ( colGroup: number[] ) => number;

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

  /**
   * **Pure-Node layout precomputation.** Takes pre-measured item sizes
   * + container width + column width + gutter, returns absolute
   * positions. NO DOM, NO instance, NO `this` — runs in any JavaScript
   * runtime including Node, edge functions, and web workers.
   *
   * The killer use case is **server-side cascading-grid layout for
   * SSR pages**: render your text-driven grid in Node, hand the item
   * sizes (from `@chenglou/pretext` or any DOM-free measurement library)
   * to `Masonry.computeLayout`, and emit the resulting positions inline
   * as `style="left: Xpx; top: Ypx;"`. The client constructs masonry
   * with `initLayout: false` and adopts the existing positions —
   * **zero hydration flash**.
   *
   * Behavior matches the browser-side layout byte-for-byte. Verified
   * by `test/visual/compute-layout.mjs`, a Node-only test that asserts
   * agreement with all 9 browser-rendered visual fixtures.
   *
   * Landed in `v5.0.0-dev.17`. See `PRETEXT_SSR_ROADMAP.md` Phase 2.
   *
   * @example
   * ```ts
   * import Masonry from 'masonry-pretext';
   * import { prepare, layout } from '@chenglou/pretext';
   *
   * const items = await loadFromCMS();
   * const sizes = items.map(item => {
   *   const prepared = prepare(item.text, '16px/1.5 Inter');
   *   const { height } = layout(prepared, 280, 24);
   *   return { outerWidth: 280, outerHeight: height };
   * });
   *
   * const { positions } = Masonry.computeLayout({
   *   items: sizes,
   *   containerWidth: 920,
   *   columnWidth: 280,
   *   gutter: 16,
   * });
   *
   * // emit positions inline as style="left: Xpx; top: Ypx;"
   * ```
   */
  static computeLayout(opts: ComputeLayoutOptions): ComputeLayoutResult;
}

/**
 * Input shape for `Masonry.computeLayout`. All sizes / widths are in
 * CSS pixels.
 */
export interface ComputeLayoutOptions {
  /** Pre-measured item sizes. Caller is responsible for measurement
   *  (use `@chenglou/pretext` for text, hardcoded values, or any
   *  DOM-free measurement strategy). */
  items: Array<{ outerWidth: number; outerHeight: number }>;

  /** Container width in pixels. The server has to know this — pick a
   *  default breakpoint width or compute from request context. */
  containerWidth: number;

  /** Per-column width in pixels (item width). Becomes the column
   *  stride after gutter is added. Set to `0` if you're using
   *  `columnWidthPercent` instead. */
  columnWidth: number;

  /** Gap between columns in pixels. Default `0`. */
  gutter?: number;

  /** Adopt the standard masonry `fitWidth` behavior — when `true`,
   *  the result includes a derived `containerWidth` snapped to the
   *  number of columns actually used (matching the upstream
   *  `_getContainerFitWidth` semantics). */
  fitWidth?: boolean;

  /** Use left-to-right placement instead of the default
   *  shortest-column-first algorithm. Equivalent to constructing with
   *  `{ horizontalOrder: true }`. */
  horizontalOrder?: boolean;

  /** Pre-positioned rectangles that items must pack around. Each entry
   *  is `{ x, y, width, height }` in pixels relative to the grid
   *  container. */
  stamps?: Array<{ x: number; y: number; width: number; height: number }>;

  /** Override for the percentage-column path (#014). When set, derives
   *  `cols = round(100 / columnWidthPercent)` and recomputes the
   *  per-column stride from the container width. Use this when your
   *  columns are sized as a percentage of the container — pass the
   *  numeric percent (e.g. `20` for 20%). */
  columnWidthPercent?: number;

  /** Custom column-pick strategy (item I / #032). Takes the array of
   *  Y values for each valid horizontal position, returns the chosen
   *  index. Default is leftmost-shortest. See `MasonryOptions.pickColumn`
   *  for the full doc. */
  pickColumn?: ( colGroup: number[] ) => number;

  /**
   * **`pretextify` shorthand** (#035 / PRETEXT_SSR Phase 6). Convenience
   * layer over the raw `pretextify` callback for the common case where
   * you have a measurement function (e.g. `@chenglou/pretext`'s
   * `prepare` + `layout`) and want masonry to build the closure +
   * WeakMap cache for you.
   *
   * If both `pretextify` and `pretextOptions` are set, `pretextify` wins.
   *
   * Example:
   *
   * ```ts
   * import { prepare, layout } from '@chenglou/pretext';
   * new Masonry(grid, {
   *   columnWidth: 280,
   *   pretextOptions: {
   *     measure: (text, font, maxWidth) => {
   *       const prepared = prepare(text, font);
   *       return layout(prepared, maxWidth, 24).height;
   *     },
   *     font: '16px/1.5 Inter, sans-serif',
   *     text: elem => elem.dataset.text || elem.textContent,
   *     padding: 24,
   *   },
   * });
   * ```
   */
  pretextOptions?: {
    /** Measurement function. Returns the rendered height for `text`
     *  laid out at `font` within `maxWidth`. Wraps `pretext.layout` or
     *  any equivalent measurement library. */
    measure: ( text: string, font: string, maxWidth: number ) => number;
    /** Font shorthand string. Passed to `measure`. */
    font: string;
    /** Optional text accessor. Defaults to `elem.textContent`. */
    text?: ( elem: HTMLElement ) => string;
    /** Optional padding to add to the measured height (e.g. for
     *  per-item border + padding). */
    padding?: number;
  };
}

/**
 * `<masonry-grid>` Custom Element wrapper (#034 / item Q). Ships as a
 * separate bundle (`dist/masonry-grid-element.{js,min.js,mjs}`) so users
 * of the imperative `new Masonry(...)` API don't pay for the wrapper bytes.
 *
 * Auto-constructs masonry on `connectedCallback`, destroys on
 * `disconnectedCallback`. Reads options from `data-*` attributes:
 * `column-width`, `gutter`, `item-selector`, `horizontal-order`,
 * `fit-width`, `static`, `percent-position`. Defaults to
 * `observeMutations: true` + `transitionDuration: 0` so the common
 * dynamic-content case works without any wiring.
 *
 * For options that don't fit in attributes (callbacks like `pretextify`
 * or `pickColumn`), set them via the `options` property:
 *
 * ```html
 * <masonry-grid id="grid" column-width="240" gutter="16">...</masonry-grid>
 * <script>
 *   document.querySelector('#grid').options = {
 *     pretextify: elem => ({ outerWidth: 240, outerHeight: 192 }),
 *   };
 * </script>
 * ```
 */
export interface MasonryGridElement extends HTMLElement {
  /** User-supplied option overrides. Setter re-constructs the masonry
   *  instance with the new options — destroys the existing one (loses
   *  `colYs`, observer state, `.on()` handlers). For incremental tweaks
   *  use `.masonry.option({ ... })` instead. */
  options: MasonryOptions | undefined;

  /** Read-only access to the underlying Masonry instance. Available
   *  after `connectedCallback`. Use this for incremental updates that
   *  shouldn't trigger a full destroy/re-construct (the `options`
   *  setter does). */
  readonly masonry: Masonry | undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    'masonry-grid': MasonryGridElement;
  }
}

/** Output shape from `Masonry.computeLayout`. */
export interface ComputeLayoutResult {
  /** One position per input item, in input order. */
  positions: Array<{ x: number; y: number }>;

  /** Number of columns the layout used. */
  cols: number;

  /** Per-column stride in pixels (item width + gutter). */
  columnWidth: number;

  /** Total height of the laid-out grid in pixels. */
  containerHeight: number;

  /** Only set when `fitWidth: true` was passed — the derived width
   *  snapped to the number of columns actually used. */
  containerWidth?: number;
}
