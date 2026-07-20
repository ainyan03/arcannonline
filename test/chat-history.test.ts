import { describe, expect, it } from 'vitest';
import { sortChatHistoryLines } from '../client/src/ui/chat';

describe('chat history ordering', () => {
  it('merges peer batches into one chronological sequence', () => {
    const received = [
      { id: 'alice-1', name: 'Alice', text: '10', at: 10 },
      { id: 'alice-2', name: 'Alice', text: '30', at: 30 },
      { id: 'bob-1', name: 'Bob', text: '20', at: 20 },
    ];
    expect(sortChatHistoryLines(received).map((line) => line.text)).toEqual([
      '10',
      '20',
      '30',
    ]);
    expect(received.map((line) => line.text)).toEqual(['10', '30', '20']);
  });
});
