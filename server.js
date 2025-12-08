import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import mercadopago from "mercadopago";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🔹 Configuración de MercadoPago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

// 🔹 Conexión a Postgres en Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🔹 Función para generar alias único
function generarAlias(refId) {
  return `alias-${refId}-${Date.now()}`;
}

// 🔹 Crear preferencia de pago
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

// 🔹 Webhook para guardar en DB
app.post("/webhook", async (req, res) => {
  const { type, data } = req.body;

  if (type === "payment" && data && data.id) {
    try {
      const paymentId = data.id;
      const payment = await mercadopago.payment.findById(paymentId);

      if (payment.body.status === "approved") {
        const refId = payment.body.external_reference || "sin-ref";
        const payerId = payment.body.payer.id || "sin-id";
        const nombre = payment.body.payer.first_name || "sin-nombre";
        const initPoint =
          payment.body.transaction_details.external_resource_url || "sin-init";
        const alias = generarAlias(refId);

        // Guardar en la tabla usuarios
        await pool.query(
          "INSERT INTO usuarios (payer_id, nombre, alias, init_point) VALUES ($1, $2, $3, $4)",
          [payerId, nombre, alias, initPoint]
        );

        console.log("✅ Pago aprobado y guardado en DB. Alias:", alias);
      }
    } catch (error) {
      console.error("❌ Error procesando webhook:", error);
    }
  }

  res.status(200).send("OK");
});

// 🔹 Endpoint para recuperar init_point por alias
app.get("/pagar/alias/:alias", async (req, res) => {
  const { alias } = req.params;
  try {
    const result = await pool.query(
      "SELECT init_point FROM usuarios WHERE alias = $1",
      [alias]
    );

    if (result.rows.length > 0) {
      res.json({ init_point: result.rows[0].init_point });
    } else {
      res.json({ error: "Alias no encontrado" });
    }
  } catch (error) {
    console.error("❌ Error consultando alias:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// 🔹 Endpoint raíz
app.get("/", (req, res) => {
  res.send("Backend Sistema Solidario activo.");
});

// 🔹 Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
