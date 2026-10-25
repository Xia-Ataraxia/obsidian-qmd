import { setIcon } from 'obsidian';

interface BuildNoticeFragmentOptions {
  id: string;
  prefix: string;
  text: string;
  immutable: boolean;
  button?: { text: string; callback: () => void };
  onMute: (id: string) => void;
}

export function buildNoticeFragment(opts: BuildNoticeFragmentOptions): DocumentFragment {
  const fragment = createFragment();
  const wrapper = createDiv({ cls: 'plugin-notice' });

  wrapper.appendChild(createEl('p', { cls: 'plugin-notice-head', text: `[${opts.prefix}]` }));
  wrapper.appendChild(createEl('p', { cls: 'plugin-notice-content', text: opts.text }));

  const actions = createDiv({ cls: 'plugin-notice-actions' });

  if (opts.button?.text && typeof opts.button.callback === 'function') {
    actions.appendChild(createActionButton(opts.button.text, opts.button.callback));
  }

  if (!opts.immutable) {
    actions.appendChild(createMuteButton(opts.id, opts.onMute));
  }

  if (actions.childElementCount > 0) {
    wrapper.appendChild(actions);
  }

  fragment.appendChild(wrapper);
  return fragment;
}

function createActionButton(text: string, callback: () => void): HTMLButtonElement {
  const button = createEl('button', { cls: 'plugin-notice-btn', type: 'button', text });
  button.addEventListener('click', callback);
  return button;
}

function createMuteButton(id: string, onMute: (id: string) => void): HTMLButtonElement {
  const button = createEl('button', { cls: 'plugin-notice-btn plugin-notice-btn--mute', type: 'button' });
  button.setAttribute('aria-label', `Mute notice: ${id}`);
  setIcon(button, 'bell-off');
  button.addEventListener('click', () => onMute(id));
  return button;
}
