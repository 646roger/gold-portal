import type { QuoteDto } from '@goldloan/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { ApplicationFlow } from './ApplicationFlow';

const QUOTE: QuoteDto = {
  netWeightGrams: '45', karat: 22, pureGoldWeightGrams: '41.250000', marketRatePerGram: '7000.00', goldValue: '288750.00', maxPermittedLtv: '0.7500',
  quotes: [
    { planId: 'PLAN_BULLET_01', planName: 'Bullet Repayment', repaymentType: 'BULLET', annualInterestRatePct: '12.00', maxLtv: '0.7000', appliedLtv: '0.7000', tenureMonths: 12, pureGoldWeightGrams: '41.250000', goldValue: '288750.00', eligibleLoanAmount: '202125', repaymentEstimate: { isEstimate: true, method: 'm', totalInterest: '24255.00', totalRepayable: '226380.00', disclaimer: 'd' } },
    { planId: 'PLAN_EMI_01', planName: 'Monthly EMI', repaymentType: 'EMI', annualInterestRatePct: '10.50', maxLtv: '0.7500', appliedLtv: '0.7500', tenureMonths: 12, pureGoldWeightGrams: '41.250000', goldValue: '288750.00', eligibleLoanAmount: '216562', repaymentEstimate: { isEstimate: true, method: 'm', monthlyInstalment: '19171.20', totalInterest: '13637.94', totalRepayable: '230049.94', disclaimer: 'd' } },
  ],
};

const apiMock = vi.hoisted(() => ({ quote: vi.fn(), createLead: vi.fn() }));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: apiMock }));

async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full name'), 'Asha Verma');
  await user.type(screen.getByLabelText('Mobile number'), '98765 43210');
  await user.type(screen.getByLabelText('Net gold weight'), '45');
  await user.click(screen.getByRole('button', { name: '22K' }));
}

beforeEach(() => { apiMock.quote.mockReset().mockResolvedValue(QUOTE); apiMock.createLead.mockReset(); });

describe('ApplicationFlow', () => {
  it('shows inline validation as the user types', async () => {
    const user = userEvent.setup();
    render(<ApplicationFlow />);
    await user.type(screen.getByLabelText('Mobile number'), '123');
    expect(await screen.findByText(/valid 10-digit Indian mobile/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Net gold weight'), '0');
    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Mobile number'));
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await waitFor(() => expect(screen.queryByText(/valid 10-digit Indian mobile/i)).not.toBeInTheDocument());
  });

  it('runs details → plan → review, blocks submit until explicit confirmation, and sends no derived amounts', async () => {
    const user = userEvent.setup();
    apiMock.createLead.mockResolvedValue({ applicationId: 'GL-7K3F9QXA', status: 'SUBMITTED', createdAt: new Date().toISOString(), planId: 'PLAN_EMI_01', planName: 'Monthly EMI', eligibleLoanAmount: '216562', goldValue: '288750.00', pureGoldWeightGrams: '41.250000', annualInterestRatePct: '10.50', tenureMonths: 12 });
    render(<ApplicationFlow />);
    await fillStep1(user);
    const slip = screen.getByRole('region', { name: /valuation slip/i });
    await waitFor(() => expect(within(slip).getAllByText('₹2,88,750').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Choose a plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review application' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Monthly EMI/ }));
    await user.click(screen.getByRole('button', { name: 'Review application' }));

    expect(screen.getByRole('heading', { name: 'Review & confirm' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit application' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(submit);

    expect(apiMock.createLead).toHaveBeenCalledTimes(1);
    expect(apiMock.createLead).toHaveBeenCalledWith({ fullName: 'Asha Verma', mobileNumber: '98765 43210', netWeightGrams: '45', karat: 22, planId: 'PLAN_EMI_01' });
    expect(await screen.findByTestId('application-id')).toHaveTextContent('GL-7K3F9QXA');
  });

  it('explains a duplicate application with the original ID and does not show success', async () => {
    const user = userEvent.setup();
    apiMock.createLead.mockRejectedValue(new ApiError(409, 'DUPLICATE_APPLICATION', 'dup', undefined, { originalApplicationId: 'GL-ORIGINAL1' }));
    render(<ApplicationFlow />);
    await fillStep1(user);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('radio', { name: /Bullet/ }));
    await user.click(screen.getByRole('button', { name: 'Review application' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already applied.*GL-ORIGINAL1/);
    expect(screen.queryByTestId('application-id')).not.toBeInTheDocument();
  });
});
