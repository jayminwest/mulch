export const recordSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Mulch Expertise Record",
  description: "A single expertise record in a Mulch domain file",
  type: "object",
  definitions: {
    classification: {
      type: "string",
      enum: ["foundational", "tactical", "observational"],
    },
    evidence: {
      type: "object",
      properties: {
        commit: { type: "string" },
        date: { type: "string" },
        issue: { type: "string" },
        file: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  oneOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "convention" },
        content: { type: "string" },
        classification: { $ref: "#/definitions/classification" },
        recorded_at: { type: "string" },
        evidence: { $ref: "#/definitions/evidence" },
      },
      required: ["type", "content", "classification", "recorded_at"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "pattern" },
        name: { type: "string" },
        description: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        classification: { $ref: "#/definitions/classification" },
        recorded_at: { type: "string" },
        evidence: { $ref: "#/definitions/evidence" },
      },
      required: ["type", "name", "description", "classification", "recorded_at"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "failure" },
        description: { type: "string" },
        resolution: { type: "string" },
        classification: { $ref: "#/definitions/classification" },
        recorded_at: { type: "string" },
        evidence: { $ref: "#/definitions/evidence" },
      },
      required: ["type", "description", "resolution", "classification", "recorded_at"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "decision" },
        title: { type: "string" },
        rationale: { type: "string" },
        date: { type: "string" },
        classification: { $ref: "#/definitions/classification" },
        recorded_at: { type: "string" },
        evidence: { $ref: "#/definitions/evidence" },
      },
      required: ["type", "title", "rationale", "classification", "recorded_at"],
      additionalProperties: false,
    },
  ],
} as const;
