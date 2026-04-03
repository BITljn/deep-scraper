import { AnimatePresence, motion } from "framer-motion";
import { useCollectJob } from "@/hooks/useCollectJob";

export interface CollectButtonProps {
  jobType?: string;
  symbol?: string;
}

export function CollectButton({ jobType = "all", symbol = "TSLA.US" }: CollectButtonProps) {
  const { trigger, isCollecting, job, error } = useCollectJob();

  const success = job?.status === "completed";
  const failed = job?.status === "failed";

  return (
    <motion.button
      type="button"
      title="Run data collection"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--cyan)]/50 bg-[var(--bg-surface)] shadow-[0_0_30px_rgba(0,212,255,0.25)] backdrop-blur-md transition hover:border-[var(--cyan)] hover:shadow-[0_0_40px_rgba(0,212,255,0.35)]"
      onClick={() => trigger(jobType, symbol)}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
    >
      <AnimatePresence mode="wait">
        {isCollecting ? (
          <motion.span
            key="spin"
            initial={{ opacity: 0, rotate: -90 }}
            animate={{ opacity: 1, rotate: 0 }}
            exit={{ opacity: 0, rotate: 90 }}
            className="inline-flex"
          >
            <svg
              className="h-6 w-6 animate-spin text-[var(--cyan)]"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-90"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </motion.span>
        ) : success ? (
          <motion.span
            key="ok"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="text-[var(--green)]"
          >
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
            </svg>
          </motion.span>
        ) : (
          <motion.span
            key="refresh"
            initial={{ opacity: 0, rotate: -40 }}
            animate={{ opacity: 1, rotate: 0 }}
            exit={{ opacity: 0, rotate: 40 }}
            className="text-[var(--cyan)]"
          >
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </motion.span>
        )}
      </AnimatePresence>
      {failed && error !== null && (
        <span className="sr-only">Collection failed: {error.message}</span>
      )}
    </motion.button>
  );
}
