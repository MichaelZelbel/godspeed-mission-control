import { z } from "zod";

export const collectionNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required");
