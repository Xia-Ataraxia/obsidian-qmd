import { setIcon, setTooltip } from 'obsidian';

interface BuildNoticeFragmentOptions {
  id: string;
  title: string;
  text: string;
  immutable: boolean;
  button?: { text: string; callback: () => void };
  onMute: (id: string) => void;
}

export function buildNoticeFragment(opts: BuildNoticeFragmentOptions): DocumentFragment {
  const fragment = createFragment();
  const wrapper = fragment.createDiv({ cls: 'qmd-notice' });

  wrapper.createEl('p', { cls: 'qmd-notice-head', text: opts.title });
  const row = wrapper.createDiv({ cls: 'qmd-notice-row' });
  row.createEl('p', { cls: 'qmd-notice-content', text: opts.text });

  if (!opts.immutable) {
    const mute = row.createEl('button', { cls: 'clickable-icon qmd-notice-mute', type: 'button' });
    setIcon(mute, 'bell-off');
    setTooltip(mute, 'Mute this notice');
    mute.addEventListener('click', () => opts.onMute(opts.id));
  }

  if (opts.button?.text && typeof opts.button.callback === 'function') {
    const action = wrapper
      .createDiv({ cls: 'qmd-notice-actions' })
      .createEl('button', { cls: 'clickable-icon qmd-notice-action', type: 'button', text: opts.button.text });
    action.addEventListener('click', opts.button.callback);
  }

  return fragment;
}
