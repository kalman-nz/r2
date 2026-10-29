const ELEMENT_TYPES = ["text", "barcode", "qr", "staticText", "image", "rect", "ellipse", "line"];
const ALIGN = ["left", "center", "right"];
const VALIGN = ["top", "middle", "bottom"];
const INKS = ["black", "white"];
const FONTS = ["system", "archivo", "condensed", "mono", "serif"];

function validateTemplateBody(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (typeof data.name !== "string" || !data.name) throw new BadRequestError("name is required");
  if (typeof data.widthMm !== "number" || data.widthMm <= 0) throw new BadRequestError("widthMm must be a positive number");
  if (typeof data.heightMm !== "number" || data.heightMm <= 0) throw new BadRequestError("heightMm must be a positive number");
  if (!Array.isArray(data.elements)) throw new BadRequestError("elements must be an array");

  for (const el of data.elements) {
    if (!el || typeof el.id !== "string") throw new BadRequestError("each element needs an id");
    if (ELEMENT_TYPES.indexOf(el.type) === -1) throw new BadRequestError("invalid element type: " + el.type);
    for (const key of ["x", "y", "width", "height"]) {
      if (typeof el[key] !== "number") throw new BadRequestError("element " + el.id + "." + key + " must be a number");
    }
    if (el.align !== undefined && ALIGN.indexOf(el.align) === -1) throw new BadRequestError("invalid align");
    if (el.valign !== undefined && VALIGN.indexOf(el.valign) === -1) throw new BadRequestError("invalid valign");
    // Any angle — older templates only used 0/90/180/270.
    if (el.rotation !== undefined && (typeof el.rotation !== "number" || !isFinite(el.rotation))) throw new BadRequestError("invalid rotation");
    if (el.font !== undefined && FONTS.indexOf(el.font) === -1) throw new BadRequestError("invalid font");
    if (el.color !== undefined && INKS.indexOf(el.color) === -1) throw new BadRequestError("invalid color");
    for (const key of ["fill", "stroke"]) {
      if (el[key] !== undefined && el[key] !== "none" && INKS.indexOf(el[key]) === -1) throw new BadRequestError("invalid " + key);
    }
  }

  if (data.sizeId !== undefined && typeof data.sizeId !== "string") throw new BadRequestError("sizeId must be a string");

  return {
    name: data.name,
    widthMm: data.widthMm,
    heightMm: data.heightMm,
    sizeId: data.sizeId || "",
    elements: data.elements,
  };
}

function toLabelJson(record) {
  return {
    id: record.id,
    name: record.get("name"),
    widthMm: record.get("widthMm"),
    heightMm: record.get("heightMm"),
    sizeId: record.getString("sizeId"),
    elements: record.get("elements"),
  };
}

module.exports = { validateTemplateBody, toLabelJson };
