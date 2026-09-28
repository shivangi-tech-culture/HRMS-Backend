/**
 * VALIDATE MIDDLEWARE — Joi against body or query
 * Usage: validate(schema) | validateQuery(schema)
 */
const run = (schema, source, opts = {}) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      allowUnknown: opts.allowUnknown ?? false,
      stripUnknown: opts.stripUnknown ?? false,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((d) => d.message.replace(/"/g, ""));
      return res.status(400).json({
        message: "Validation failed — unknown or invalid fields",
        errors,
      });
    }

    req[source] = value;
    next();
  };
};

/** Express middleware: validate req.body (reject unknown keys) */
const validate = (schema) =>
  run(schema, "body", { allowUnknown: false, stripUnknown: false });

/** Express middleware: validate req.query (strip unknown; convert page/limit) */
const validateQuery = (schema) =>
  run(schema, "query", { allowUnknown: true, stripUnknown: true });

module.exports = { validate, validateQuery };
