import { z } from "zod";

/**
 * Shapes of the Salla responses this tool depends on. They are deliberately loose about
 * anything unused and strict about the few fields detection relies on, so an unannounced
 * change surfaces as a clear mismatch on the field that matters instead of a silent
 * `undefined` further downstream.
 */

const nullableText = z.string().nullish();

export const productSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  sku: nullableText,
  image: z.looseObject({ url: z.string() }).nullish(),
  original_image: nullableText,
  images: z.array(z.looseObject({ url: z.string() })).nullish(),
});

export const productListSchema = z.looseObject({
  data: z.array(productSchema),
});

export const menuSchema: z.ZodType<MenuEntry> = z.lazy(() =>
  z.looseObject({
    url: nullableText,
    children: z.array(menuSchema).nullish(),
  }),
);

export interface MenuEntry {
  readonly url?: string | null | undefined;
  readonly children?: readonly MenuEntry[] | null | undefined;
}

export const menuListSchema = z.looseObject({
  data: z.array(menuSchema),
});

export const appDetailsSchema = z.looseObject({
  data: z.looseObject({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    url: nullableText,
    policy: nullableText,
    faq: nullableText,
    support: z.looseObject({ url: nullableText }).nullish(),
    company: z
      .looseObject({ id: z.union([z.string(), z.number()]).nullish(), name: nullableText })
      .nullish(),
    categories: z
      .array(z.looseObject({ id: z.union([z.string(), z.number()]), name: z.string() }))
      .nullish(),
  }),
});

export const appReviewsSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.union([z.string(), z.number()]),
      name: z.string(),
      avatar: nullableText,
      rating: z.number().nullish(),
      date: nullableText,
    }),
  ),
  cursor: z.looseObject({ next: z.number().nullish() }).nullish(),
});

export const searchTokenSchema = z.looseObject({
  data: z.looseObject({
    token: z.string(),
    expires_at: nullableText,
    index: nullableText,
  }),
});

export const catalogHitSchema = z.looseObject({
  id: z.string(),
  name: z.looseObject({ ar: z.string(), en: z.string().nullish() }),
  company: z.looseObject({ name: z.looseObject({ ar: nullableText, en: nullableText }) }).nullish(),
  categories: z.array(z.looseObject({ name: z.looseObject({ ar: z.string() }) })).nullish(),
  is_salla: z.boolean().nullish(),
  installs_count: z.number().nullish(),
});

export const catalogPageSchema = z.looseObject({
  hits: z.array(catalogHitSchema),
  nbPages: z.number(),
});

const demoStoreSchema = z.looseObject({ preview_url: nullableText });

export const themeListingSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  developer: nullableText,
  version: nullableText,
  is_beta: z.boolean().optional().catch(undefined),
  ratings: z
    .looseObject({ rating: z.number().optional(), count: z.number().optional() })
    .optional()
    .catch(undefined),
  demo_stores: z.array(demoStoreSchema).optional().catch(undefined),
});

export const themeCatalogSchema = z.array(themeListingSchema);

export type ProductPayload = z.output<typeof productSchema>;
export type AppDetailsPayload = z.output<typeof appDetailsSchema>["data"];
export type AppReviewPayload = z.output<typeof appReviewsSchema>["data"][number];
export type CatalogHit = z.output<typeof catalogHitSchema>;
