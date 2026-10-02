/** OASIS common objects, pinned to 55ba7598cbd5a52577b6887871505d931d85cb61.
 * https://github.com/oasis-open/cti-stix-common-objects/tree/55ba7598cbd5a52577b6887871505d931d85cb61
 * Field-for-field TLP 2.0 objects (bundle wrappers omitted). See third-party license.
 */
export const TLP2_EXTENSION_ID = 'extension-definition--60a3c5c5-0d10-413e-aab3-9e08dde9e88d';
export const TLP2_EXTENSION = {
  type: 'extension-definition', spec_version: '2.1', id: TLP2_EXTENSION_ID,
  name: 'TLP 2.0', description: 'This defines TLP 2.0 as a STIX extension',
  created: '2022-10-01T00:00:00.000Z', modified: '2022-10-01T00:00:00.000Z',
  created_by_ref: 'identity--b3bca3c2-1f3d-4b54-b44f-dac42c3a8f01',
  schema: 'https://github.com/oasis-open/cti-stix-common-objects/tree/master/extension-definition-specifications/tlp-2.0',
  version: '1.0.0', extension_types: ['property-extension'],
};
const tlp2 = (id: string, name: string, value: string) => ({
  type: 'marking-definition' as const, spec_version: '2.1' as const, id,
  created: '2022-10-01T00:00:00.000Z', name,
  extensions: { [TLP2_EXTENSION_ID]: { extension_type: 'property-extension', tlp_2_0: value } },
});
export const STIX_TLP_MARKING_DEFS = {
  'TLP:CLEAR': tlp2('marking-definition--94868c89-83c2-464b-929b-a1a8aa3c8487', 'TLP:CLEAR', 'clear'),
  'TLP:GREEN': tlp2('marking-definition--bab4a63c-aed9-4cf5-a766-dfca5abac2bb', 'TLP:GREEN', 'green'),
  'TLP:AMBER': tlp2('marking-definition--55d920b0-5e8b-4f79-9ee9-91f868d9b421', 'TLP:AMBER', 'amber'),
  'TLP:AMBER+STRICT': tlp2('marking-definition--939a9414-2ddd-4d32-a0cd-375ea402b003', 'TLP:AMBER+STRICT', 'amber+strict'),
  'TLP:RED': tlp2('marking-definition--e828b379-4e03-4974-9ac4-e53a884c97c1', 'TLP:RED', 'red'),
} as Record<string, ReturnType<typeof tlp2>>;

/** Version remains explicit: legacy AMBER is not automatically relabelled TLP2 AMBER. */
export const LEGACY_TLP_LEVELS: Record<string, string> = {
  'marking-definition--613f2e26-407d-48c7-9eca-b8e91df99dc9': 'TLP1:WHITE',
  'marking-definition--34098fce-860f-48ae-8e50-ebd3cc5e41da': 'TLP1:GREEN',
  'marking-definition--f88d31f6-486f-44da-b317-01333bde0b82': 'TLP1:AMBER',
  'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed': 'TLP1:RED',
};
