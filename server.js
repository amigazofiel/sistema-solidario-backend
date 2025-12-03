import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import mercadopago from "mercadopago";

const app = express();
app.use(cors());
app.use(bodyParser.json());

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

app.get("/pagar/:refId", async (req, res) => {
  const refId = req.params.refId || "sin-ref";

  try {
    const preference = {
      items: [
        {
          title: "Sistema Solidario",
          unit_price: 2500,
          quantity: 1
        }
      ],
      back_urls: {
        success: `https://ejemplo.com/gracias?ref=${encodeURIComponent(refId)}`,
        failure: `https://ejemplo.com/error`,
        pending: `https://ejemplo.com/pendiente`
      },
      auto_return: "approved",
      notification_url: `https://TU-RAILWAY-URL/webhook`,
      external_reference: refId
    };

    const response = await mercadopago.preferences.create(preference);
    return res.json({ init_point: response.body.init_point });
  } catch (err) {
    console.error("Error creando preferencia:", err);
    return res.status(500).json({ error: "No se pudo crear la preferencia" });
  }
});

app.post("/webhook", async (req, res) => {
  const { type, data } = req.body;

  if (type === "payment" && data && data.id) {
    const paymentId = data.id;
    const payment = await mercadopago.payment.findById(paymentId);

    if (payment.body.status === "approved") {
      const refId = payment.body.external_reference || "sin-ref";
      console.log("Pago aprobado. Ref:", refId);
    }
  }

  res.status(200).send("OK");
});

app.get("/", (req, res) => {
  res.send("Backend Sistema Solidario activo.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en ${PORT}`);
});
