/**
 * C-MEDIA-1: chat, agent-audit and meeting messages never load remote media,
 * so text a model was steered into writing cannot beacon when it is displayed.
 * ChatView always passes onEntityClick, which turns [note:id] references into
 * links after the markdown is rendered, so every case renders with it.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageBubble } from '../components/Chat/ChatMessage';

afterEach(cleanup);

const beacon = 'https://c.example/?d=1';

describe('C-MEDIA-1 chat messages render no remote media', () => {
  it.each([
    ['markdown image', `Result ![x](${beacon})`],
    ['HTML image', `Result <img src="${beacon}">`],
    ['meeting turn', `**🛡️ CISO:** Result ![x](${beacon})`],
    ['media elements', `Result <video poster="${beacon}"></video><audio src="${beacon}"></audio><picture><source srcset="${beacon}"></picture><svg><image href="${beacon}"/></svg>`],
    // An entity reference inside a link title: the link is rewritten after the markdown is sanitised.
    ['entity reference in a link title', `Result [a](https://e.example "[note:x] <img src=${beacon}>")`],
  ])('an assistant %s', (_label, content) => {
    const { container } = render(<ChatMessageBubble role="assistant" content={content} onEntityClick={vi.fn()} />);
    expect(container.innerHTML).not.toMatch(/<(?:img|image|video|audio|source|picture|svg)\b/);
    expect(container.querySelector('[src], [srcset], [poster]')).toBeNull();
    expect(container.textContent).toContain('Result');
  });

  it('keeps links, entity links and the analyst\'s own pasted images', () => {
    const { container } = render(<ChatMessageBubble role="assistant" content="See [the advisory](https://www.cisa.gov/advisory) and [note:n1:Triage]" onEntityClick={vi.fn()} />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://www.cisa.gov/advisory');
    expect(container.querySelector('[data-entity-type="note"]')?.getAttribute('data-entity-id')).toBe('n1');
    cleanup();
    const attachment = { type: 'image' as const, name: 'screenshot.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' };
    const user = render(<ChatMessageBubble role="user" content="Look" attachments={[attachment]} />);
    expect(user.container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});
