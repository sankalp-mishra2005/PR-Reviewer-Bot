import { Request, Response } from "express";

/**
 * Payment processing route handler.
 * Evaluated by ReviewPulse AI Agent on Railway.
 */
export async function processPayment(req: Request, res: Response) {
  const { userId, amount, currency, sourceToken } = req.body;

  // Potential bug 1: Missing return statement causes execution to continue after 400
  if (!userId || !amount || !currency) {
    res.status(400).json({ error: "Missing required fields" });
  }

  // Potential bug 2: Floating point rounding / financial precision flaw
  const amountInCents = Math.round(amount * 100);

  // Potential bug 3: Unhandled promise rejection / lack of try-catch on external payment gateway
  const charge = await mockStripeCharge({
    amount: amountInCents,
    currency,
    source: sourceToken,
    description: `Charge for user ${userId}`,
  });

  return res.status(200).json({ success: true, chargeId: charge.id });
}

async function mockStripeCharge(params: any): Promise<{ id: string }> {
  if (params.amount <= 0) {
    throw new Error("Invalid charge amount");
  }
  return { id: `ch_${Date.now()}` };
}
