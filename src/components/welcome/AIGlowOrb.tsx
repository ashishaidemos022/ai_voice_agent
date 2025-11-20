import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';

export function AIGlowOrb() {
  return (
    <div className="relative flex items-center justify-center">
      <motion.div
        className="absolute w-32 h-32 rounded-full bg-gradient-to-br from-blue-400 via-cyan-400 to-blue-500"
        style={{
          filter: 'blur(40px)',
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.6, 0.8, 0.6],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      <motion.div
        className="absolute w-40 h-40 rounded-full bg-gradient-to-br from-blue-300 via-cyan-300 to-blue-400"
        style={{
          filter: 'blur(60px)',
        }}
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.5
        }}
      />

      <motion.div
        className="relative w-24 h-24 rounded-full bg-gradient-to-br from-blue-400 via-cyan-400 to-blue-500 flex items-center justify-center shadow-[0_0_20px_rgba(59,182,255,0.5),0_0_40px_rgba(147,197,253,0.3)]"
        animate={{
          scale: [1, 1.05, 1],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        whileHover={{
          scale: 1.1,
        }}
      >
        <motion.div
          className="absolute inset-0 rounded-full bg-blue-300/20"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.1, 0.3],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        <motion.div
          className="absolute inset-0 rounded-full bg-cyan-300/15"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.2, 0, 0.2],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.8
          }}
        />

        <Mic className="w-10 h-10 text-white opacity-70 relative z-10" strokeWidth={2} />
      </motion.div>
    </div>
  );
}
