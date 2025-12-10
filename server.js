const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { MercadoPagoConfig, Preference } = require("mercadopago");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MercadoPago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || "TEST-TOKEN"
});
const preferenceClient = new Preference(mpClient);

// PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// Alias único
function generarAlias() {
  return `alias-${uuidv4().slice(0, 8)}`;
}

// Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Endpoint de pago único
app.get("/pagar/:refId", async (req, res) => {
  const refId = req.params.refId || "sin-ref";

  try {
    const preference = {
      items: [{ title: "Sistema Solidario", unit_price: 2500, quantity: 1 }],
      back_urls: {
        success: `https://tu-dominio.com/gracias?ref=${encodeURIComponent(refId)}`,
        failure: `https://tu-dominio.com/error`,
        pending: `https://tu-dominio.com/pendiente`
      },
      auto_return: "approved",
      notification_url: `${process.env.BASE_URL}/webhook`,
      external_reference: refId
    };

    const response = await preferenceClient.create({ body: preference });
    res.json({ init_point: response.id });
  } catch (err) {
    console.error("Error creando preferencia:", err);
    res.status(500).json({ error: "No se pudo crear la preferencia" });
  }
});

// Suscripción mensual con reparto
app.post("/suscripcion/:alias", async (req, res) => {
  const { alias } = req.params;
  const { usuario_id, email, patrocinador_id } = req.body;

  try {
    const preference = {
      items: [{ title: "Suscripción Sistema Solidario", unit_price: 15000, quantity: 1 }],
      external_reference: `${usuario_id}-${alias}`,
      marketplace_fee: 5000,
      payer: { email },
      back_urls: {
        success: "https://sistema-solidario.com/success",
        failure: "https://sistema-solidario.com/failure",
        pending: "https://sistema-solidario.com/pending"
      },
      auto_return: "approved",
      notification_url: `${process.env.BASE_URL}/webhook`
    };

    const response = await preferenceClient.create({ body: preference });

    const nuevoAlias = generarAlias();
    const result = await pool.query(
      "INSERT INTO usuarios (usuario_id, email, alias, patrocinador_id, init_point) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [usuario_id, email, nuevoAlias, patrocinador_id || null, response.id]
    );

    const enlaceAfiliado = `https://sistema-solidario.com/pagar/alias/${nuevoAlias}`;
    const mailOptions = {
      from: "Sistema Solidario <no-reply@sistema-solidario.com>",
      to: email,
      subject: "Tu enlace de afiliado - Sistema Solidario",
      text: `¡Bienvenido! Este es tu enlace único para invitar personas:\n\n${enlaceAfiliado}\n\nCada persona que se suscriba con tu enlace te generará ingresos recurrentes.`,
    };
    await transporter.sendMail(mailOptions);

    res.json({
      init_point: response.id,
      enlaceAfiliado,
      usuario: result.rows[0]
    });
  } catch (error) {
    console.error("Error creando suscripción:", error);
    res.status(500).json({ error: "No se pudo crear la suscripción" });
  }
});

// Webhook de MercadoPago
app.post("/webhook", async (req, res) => {
  const { type, data } = req.body;

  if (type === "payment" && data && data.id) {
    try {
      const refId = data.id;
      const alias = generarAlias();

      await pool.query(
        "INSERT INTO pagos (payment_id, alias) VALUES ($1, $2)",
        [refId, alias]
      );

      console.log("Pago registrado con alias:", alias);
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

// Exportar para Vercel
module.exports = app;
// Redeploy trigger - Juan Ayala father