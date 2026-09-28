/**
 * VALIDATE MIDDLEWARE — run a Joi schema against req.body
 * Usage: router.post("/", protect, validate(schema), handler)
 */

/** Express middleware: validate req.body with Joi schema */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: false,
    });

    if (error) {
      const errors = error.details.map((d) => d.message.replace(/"/g, ""));
      return res.status(400).json({
        message: "Validation failed — unknown or invalid fields",
        errors,
      });
    }

    req.body = value;
    next();
  };
};

module.exports = { validate };
