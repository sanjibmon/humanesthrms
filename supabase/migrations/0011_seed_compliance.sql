-- Reference data for the calendar and the Regulatory Change Center. Every row carries a confidence level and a source;
-- nothing here is legal advice, and rows marked medium or low must be checked against the official notification.

insert into public.compliance_calendar_rules (code, title, filing_type, frequency, due_rule, confidence, source, notes) values
  ('PF_MONTHLY',  'PF contribution and ECR', 'pf_ecr',      'monthly',   '{"day":15,"month_offset":1}', 'high',   'EPFO: contribution and ECR by the 15th of the following month', 'A short grace period may apply; the calendar uses the 15th.'),
  ('ESI_MONTHLY', 'ESI contribution',        'esi_challan', 'monthly',   '{"day":15,"month_offset":1}', 'high',   'ESIC: contribution by the 15th of the following month', null),
  ('TDS_MONTHLY', 'TDS on salary deposit',   'tds_challan', 'monthly',   '{"day":7,"month_offset":1,"march_due":"30-04"}', 'high', 'Income tax: deposit by the 7th of the following month; March deductions by 30 April', 'Section numbers changed under the Income-tax Act 2025; due dates as published for FY 2026-27.'),
  ('TDS_RETURN',  'Quarterly TDS return (Form 24Q / Form 138 under the 2025 Act)', 'tds_return', 'quarterly', '{"Q1":"31-07","Q2":"31-10","Q3":"31-01","Q4":"31-05"}', 'medium', 'Income tax: quarterly statement due dates', 'Confirm the form number and portal flow for the first quarters under the 2025 Act.'),
  ('FORM16',      'Form 16 / Form 130 issue to employees', 'form16', 'annual', '{"month":6,"day":15}', 'medium', 'Income tax: issue by 15 June after the financial year', 'Form 130 under the 2025 Act.'),
  ('PT_STATE',    'Professional Tax return and payment', 'pt_return', 'monthly', '{"varies":"by state"}', 'low', 'State Professional Tax Acts', 'Due dates differ by state and by employer size. Configure per state after verifying with the state notification.'),
  ('LWF_STATE',   'Labour Welfare Fund contribution', 'lwf_return', 'annual', '{"varies":"by state"}', 'low', 'State Labour Welfare Fund Acts', 'Months and due dates differ by state. Configure per state after verification.')
on conflict do nothing;

insert into public.regulatory_changes (title, summary, area, status, effective_from, rule_key, source, confidence) values
  ('EPFO wage ceiling to Rs 25,000',
   'The Union Cabinet approved raising the EPF statutory wage ceiling from Rs 15,000 to Rs 25,000 on 16 Sep 2026. No effective date has been stated in the official release and the Gazette notification is pending. HumaNest treats it as announced: employers can simulate the cost impact but payroll keeps using Rs 15,000 until the change is published as in force.',
   'pf', 'announced', null, 'pf.wageCeiling', 'Union Cabinet decision, 16 Sep 2026 (pmindia.gov.in). Effective date unconfirmed.', 'medium'),
  ('Four Labour Codes in force',
   'The Code on Wages, Industrial Relations Code, Code on Social Security and the OSH Code came into force on 21 Nov 2025. Wages now follow the Code definition with the 50% rule, and fixed-term employees earn pro-rata gratuity after one year.',
   'labour_code', 'in_force', '2025-11-21', 'wage.excludedCapPct', 'Ministry of Labour and Employment notifications (Nov 2025)', 'high'),
  ('Income-tax Act 2025 replaces the 1961 Act',
   'From 1 Apr 2026 the Income-tax Act 2025 applies. Form 16 becomes Form 130, the quarterly TDS return Form 24Q becomes Form 138, and section 192 becomes section 392. Slab rates and the Rs 60,000 rebate up to Rs 12 lakh in the new regime carry forward.',
   'tds', 'in_force', '2026-04-01', null, 'Income-tax Act 2025 and CBDT notifications', 'high'),
  ('DPDP Act: full compliance by 13 May 2027',
   'The Digital Personal Data Protection Rules apply in phases; obligations on data fiduciaries (notice, consent, security safeguards, breach intimation, retention and erasure, grievance redressal) apply in full by 13 May 2027. HumaNest ships the consent, notice, request, breach and retention tools now.',
   'dpdp', 'announced', '2027-05-13', null, 'DPDP Rules 2025 (MeitY)', 'medium'),
  ('Bonus eligibility ceiling and calculation floor under the Code on Wages',
   'Bonus eligibility ceiling Rs 21,000 a month and calculation on the higher of Rs 7,000 or the applicable minimum wage, effective 21 Nov 2025.',
   'bonus', 'in_force', '2025-11-21', 'bonus.eligibilityCeiling', 'Ministry of Labour and Employment notification (Aug 2026)', 'medium');
