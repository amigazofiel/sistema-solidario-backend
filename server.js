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

// =======================
// Configuración MercadoPago
// =======================
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || "TEST-TOKEN",
});
const preferenceClient = new Preference(mpClient);

// =======================
// Configuración PostgreSQL
// =======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// =======================
// Función para alias único
// =======================
function generarAlias() {
  return `alias-${uuidv4().slice(0, 8)}`;
}

// =======================
// Configuración Nodemailer
// =======================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// =======================
// Endpoint de pago único
// =======================
app.get("/pagar/:refId", async (req, res) => {
  const refId = req.params.refId || "sin-ref";

  try {
    const preference = {
      items: [
        {
          title: "Sistema Solidario",
          unit_price: 2500,
          quantity: 1,
        },
      ],
      back_urls: {
        success: `https://tu-dominio.com/gracias?ref=${encodeURIComponent(
          refId
        )}`,
        failure: `https://tu-dominio.com/error`,
        pending: `https://tu-dominio.com/pendiente`,
      },
      auto_return: "approved",
      notification_url: `${process.env.BASE_URL}/webhook`,
      external_reference: refId,
    };

    const response = await preferenceClient.create({ body: preference });

    // OJO: MercadoPago devuelve init_point en response.init_point
    res.json({ init_point: response.init_point || response.id });
  } catch (err) {
    console.error("Error creando preferencia:", err);
    res
      .status(500)
      .json({ error: "No se pudo crear la preferencia", detalle: err.message });
  }
});

// =======================
// Suscripción mensual con reparto
// =======================
app.post("/suscripcion/:alias", async (req, res) => {
  const { alias } = req.params;
  const { usuario_id, email, patrocinador_id } = req.body;

  console.log("POST /suscripcion/:alias llamado con:", {
    alias,
    usuario_id,
    email,
    patrocinador_id,
  });

  // Validaciones básicas para evitar 500 tontos
  if (!usuario_id || !email) {
    return res.status(400).json({
      error: "Faltan datos obligatorios",
      detalle: "Se requieren usuario_id y email",
    });
  }

  try {
    // 1. Buscar el patrocinador por alias (si lo necesitás)
    const patrocinador = await pool.query(
      "SELECT * FROM usuarios WHERE alias = $1",
      [alias]
    );

    if (patrocinador.rows.length === 0) {
      console.warn("Alias de patrocinador no encontrado:", alias);
      // Podés decidir si esto es error o si igual creás la suscripción
      // Por ahora devolvemos error claro:
      return res
        .status(404)
        .json({ error: "Alias de patrocinador no encontrado" });
    }

    // 2. Crear preferencia en MercadoPago
    const preference = {
      items: [
        {
          title: "Suscripción Sistema Solidario",
          unit_price: 15000,
          quantity: 1,
        },
      ],
      external_reference: `${usuario_id}-${alias}`,
      marketplace_fee: 5000,
      payer: { email },
      back_urls: {
        success: "https://sistema-solidario.com/success",
        failure: "https://sistema-solidario.com/failure",
        pending: "https://sistema-solidario.com/pending",
      },
      auto_return: "approved",
      notification_url: `${process.env.BASE_URL}/webhook`,
    };

    const response = await preferenceClient.create({ body: preference });

    const initPoint =
      response.init_point || response.body?.init_point || response.id;

    // 3. Generar nuevo alias del nuevo usuario
    const nuevoAlias = generarAlias();

    // 4. Guardar usuario en la tabla usuarios
    // IMPORTANTE: tu tabla actual tiene columnas:
    // id | payer_id | nombre | alias | init_point | usuario_id
    // El INSERT que tenías usaba columnas que NO existen (email, patrocinador_id)
    // Lo corrijo para que coincida con tu tabla real.
    const result = await pool.query(
      "INSERT INTO usuarios (payer_id, nombre, alias, init_point, usuario_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [
        "pending", // payer_id (hasta que llegue el pago real)
        usuario_id, // nombre: por ahora usamos usuario_id como identificador visible
        nuevoAlias, // alias del nuevo usuario
        initPoint, // init_point de MercadoPago
        usuario_id, // usuario_id
      ]
    );

    // 5. Construir enlace de afiliado para el NUEVO usuario
    const enlaceAfiliado = `https://sistema-solidario.com/pagar/alias/${nuevoAlias}`;

    // 6. Enviar correo con el enlace de afiliado
    const mailOptions = {
      from: "Sistema Solidario <no-reply@sistema-solidario.com>",
      to: email,
      subject: "Tu enlace de afiliado - Sistema Solidario",
      text: `¡Bienvenido! Este es tu enlace único para invitar personas:\n\n${enlaceAfiliado}\n\nCada persona que se suscriba con tu enlace te generará ingresos recurrentes.`,
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (errMail) {
      console.error("Error enviando correo:", errMail);
      // No rompemos todo por un error de mail; solo lo registramos
    }

    // 7. Respuesta al frontend
    res.json({
      init_point: initPoint,
      enlaceAfiliado,
      usuario: result.rows[0],
    });
  } catch (error) {
    console.error("Error creando suscripción:", error);
    res.status(500).json({
      error: "No se pudo crear la suscripción",
      detalle: error.message,
    });
  }
});

// =======================
// Webhook de MercadoPago
// =======================
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

// =======================
// Consultar alias
// =======================
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
      res.status(404).json({ error: "Alias no encontrado" });
    }
  } catch (error) {
    console.error("Error consultando alias:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// =======================
// Endpoint raíz
// =======================
app.get("/", (req, res) => {
  res.send("Backend Sistema Solidario activo.");
});

// =======================
// Exportar para Vercel
// =======================
module.exports = app;
// Redeploy trigger - Juan Ayala father
