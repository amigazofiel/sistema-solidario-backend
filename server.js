// Ajuste final para despliegue en Vercel
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mercadopago = require("mercadopago");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuración de MercadoPago (SDK clásico)
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN || "TEST-TOKEN"
});

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// Generar alias único
function generarAlias(refId) {
  return `alias-${refId}-${Date.now()}`;
}

// Endpoint de pago
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
        success: `https://tu-dominio.com/gracias?ref=${encodeURIComponent(refId)}`,
        failure: `https://tu-dominio.com/error`,
        pending: `https://tu-dominio.com/pendiente`
      },
      auto_return: "approved",
      notification_url: `${process.env.BASE_URL}/webhook`,
      external_reference: refId
    };

    const response = await mercadopago.preferences.create(preference);
    return res.json({ init_point: response.body.init_point });
  } catch (err) {
    console.error("Error creando preferencia:", err);
    return res.status(500).json({ error: "No se pudo crear la preferencia" });
  }
});

// Webhook de MercadoPago
app.post("/webhook", async (req, res) => {
  const { type, data } = req.body;

  if (type === "payment" && data && data.id) {
    try {
      const refId = data.id;
      const alias = generarAlias(refId);

      await pool.query(
        "INSERT INTO usuarios (payer_id, nombre, alias, init_point) VALUES ($1, $2, $3, $4)",
        ["juan-001", "Juan", alias, "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=TEST-ALIAS-001"]
      );

      console.log("Alias guardado:", alias);
    } catch (error) {
      console.error("Error en webhook:", error);
    }
  }

  res.status(200).send("OK");
});

// Consultar alias
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
    console.error("Error consultando alias:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Endpoint raíz
app.get("/", (req, res) => {
  res.send("Backend Sistema Solidario activo.");
});

// 🚀 Exportar la app para Vercel (no usar app.listen)
module.exports = app;
