import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantPanel } from './AssistantPanel';

const apiMock = vi.hoisted(() => ({ chatStatus: vi.fn(), chat: vi.fn(), chatConfirm: vi.fn() }));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: apiMock }));

const SUMMARY = { fullName: 'Asha Verma', maskedMobile: '+91 XXXXXX3210', netWeightGrams: '45', karat: 22, planId: 'PLAN_EMI_01', planName: 'Monthly EMI', pureGoldWeightGrams: '41.250000', goldValue: '288750.00', eligibleLoanAmount: '216562', annualInterestRatePct: '10.50', tenureMonths: 12, repaymentType: 'EMI' as const, hash: 'a'.repeat(64) };

beforeEach(() => { Object.values(apiMock).forEach((m) => m.mockReset()); apiMock.chatStatus.mockResolvedValue({ mode: 'demo' }); });

describe('AssistantPanel', () => {
  it('labels demo mode clearly as scripted, not AI', async () => {
    render(<AssistantPanel />);
    expect(await screen.findByText(/Demo mode · scripted, not AI/)).toBeInTheDocument();
    expect(screen.getByText(/deterministic scripted assistant, not an AI model/i)).toBeInTheDocument();
  });

  it('shows a review card with an explicit Confirm button; submission happens only on click', async () => {
    const user = userEvent.setup();
    apiMock.chat.mockResolvedValue({ sessionId: 's1', mode: 'demo', toolsUsed: ['submit_application'], messages: [{ role: 'assistant', content: 'Please review.' }], confirmation: SUMMARY });
    apiMock.chatConfirm.mockResolvedValue({ sessionId: 's1', mode: 'demo', toolsUsed: ['submit_application'], messages: [{ role: 'assistant', content: 'Submitted.' }], application: { applicationId: 'GL-7K3F9QXA', duplicate: false } });
    render(<AssistantPanel />);
    await user.type(screen.getByLabelText('Message'), 'apply please');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const confirm = await screen.findByRole('button', { name: /Confirm & submit/ });
    expect(apiMock.chatConfirm).not.toHaveBeenCalled(); // nothing submitted by merely showing the summary
    expect(screen.getByText('+91 XXXXXX3210')).toBeInTheDocument(); // masked in the review card
    await user.click(confirm);
    expect(apiMock.chatConfirm).toHaveBeenCalledWith({ sessionId: 's1', summaryHash: SUMMARY.hash });
    expect(await screen.findByText('GL-7K3F9QXA')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm & submit/ })).not.toBeInTheDocument(); // can't be pressed twice
  });

  it('recovers from a failed turn with a retry control', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../../lib/api');
    apiMock.chat.mockRejectedValueOnce(new ApiError(503, 'AI_UNAVAILABLE', 'The assistant is unavailable right now.'));
    apiMock.chat.mockResolvedValueOnce({ sessionId: 's2', mode: 'demo', toolsUsed: [], messages: [{ role: 'assistant', content: 'Hello again.' }] });
    render(<AssistantPanel />);
    await user.type(screen.getByLabelText('Message'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/unavailable right now/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Hello again.')).toBeInTheDocument();
  });
});
