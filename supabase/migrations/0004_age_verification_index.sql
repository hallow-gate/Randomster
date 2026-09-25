-- 0004_age_verification_index.sql
create index if not exists idx_profiles_age_verification_ref on profiles(age_verification_ref);
