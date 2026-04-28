declare module 'tinykeys' {
  export interface KeyBindingMap {
    [keybinding: string]: (event: KeyboardEvent) => void;
  }
  export interface KeyBindingOptions {
    timeout?: number;
    event?: 'keydown' | 'keyup';
    capture?: boolean;
  }
  export function tinykeys(
    target: Window | HTMLElement,
    keyBindingMap: KeyBindingMap,
    options?: KeyBindingOptions,
  ): () => void;
}
