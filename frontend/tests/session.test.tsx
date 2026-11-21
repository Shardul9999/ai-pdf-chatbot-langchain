/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import Home from '@/app/page';

let mockUser = { id: 'alice', firstName: 'Alice' };
const mockToast = jest.fn();
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ user: mockUser, isLoaded: true }),
  UserButton: () => <button>Account</button>,
}));
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

beforeEach(() => {
  localStorage.clear();
  mockUser = { id: 'alice', firstName: 'Alice' };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockReturnValue({ matches: true }),
  });
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(null);
  HTMLElement.prototype.scrollTo = jest.fn();
  global.fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ messages: [], documents: [], nextCursor: null }),
  }));
});

test('restores account-scoped sessions and discards a late response from the previous account', async () => {
  localStorage.setItem('readr:session:alice', 'alice-thread');
  localStorage.setItem('readr:session:bob', 'bob-thread');
  let resolveAlice: (value: Response) => void = () => undefined;
  jest.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/history?sessionId=alice-thread'))
      return (await new Promise((resolve) => {
        resolveAlice = resolve;
      })) as Response;
    return {
      ok: true,
      json: async () => ({ messages: [], documents: [], nextCursor: null }),
    } as Response;
  });
  const view = render(<Home />);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/history?sessionId=alice-thread',
      expect.anything(),
    ),
  );
  mockUser = { id: 'bob', firstName: 'Bob' };
  view.rerender(<Home />);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/history?sessionId=bob-thread',
      expect.anything(),
    ),
  );
  await act(async () => {
    resolveAlice({
      ok: true,
      json: async () => ({
        messages: [{ role: 'assistant', content: 'Alice private message' }],
        nextCursor: null,
      }),
    } as Response);
  });
  expect(screen.queryByText('Alice private message')).toBeNull();
  expect(localStorage.getItem('readr:session:bob')).toBe('bob-thread');
});

test('a history outage keeps the existing conversation instead of silently replacing it', async () => {
  localStorage.setItem('readr:session:alice', 'saved-thread');
  jest.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  render(<Home />);
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'History unavailable' }),
    ),
  );
  expect(localStorage.getItem('readr:session:alice')).toBe('saved-thread');
});

test('preserves the previous release conversation during the scoped-key migration', async () => {
  localStorage.setItem('chatSessionId', 'legacy-thread');
  render(<Home />);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/history?sessionId=legacy-thread',
      expect.anything(),
    ),
  );
  expect(localStorage.getItem('readr:session:alice')).toBe('legacy-thread');
});
