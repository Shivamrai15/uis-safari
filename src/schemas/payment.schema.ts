import * as z from "zod";

export const PaymentSheetSchema = z.object({
  priceId: z.string().startsWith("price_"),
});
