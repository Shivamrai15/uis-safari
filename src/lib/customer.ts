import { db } from "./db.js";
import { stripe } from "./stripe.js";

export async function createOrRetrieveCustomer(
    {userId, email}:{userId: string, email: string}
) {
    try {
        
        const customer = await db.customer.findUnique({
            where : {
                id : userId
            }
        });

        if(!customer){
            const customerData : { metadata : { id : string }; email? :string ;} = {
                metadata : {
                    id : userId
                }
            }
            if ( email ) customerData.email = email;
            const customer = await stripe.customers.create(customerData);
            await db.customer.create({
                data : {
                    id : userId,
                    stripeCustomerId : customer.id,
                }
            });
            return customer.id;
        }

        return customer.stripeCustomerId

    } catch (error) {
        throw error;
    }
}