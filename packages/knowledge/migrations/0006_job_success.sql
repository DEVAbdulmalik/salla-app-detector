-- A job that runs every night and fails every night looked healthy, because only the time
-- of its last attempt was kept. The last success is what says whether its output is fresh.
alter table job_state add column last_success_at timestamptz;

update job_state set last_success_at = last_run_at where last_status = 'completed';
