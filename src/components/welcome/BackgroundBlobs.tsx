import { motion } from 'framer-motion';

export function BackgroundBlobs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full bg-blue-500/10 blur-3xl"
        style={{ top: '10%', left: '15%' }}
        animate={{
          x: [0, 30, -20, 0],
          y: [0, -40, 20, 0],
          scale: [1, 1.1, 0.95, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full bg-cyan-500/8 blur-3xl"
        style={{ top: '40%', right: '10%' }}
        animate={{
          x: [0, -40, 30, 0],
          y: [0, 30, -30, 0],
          scale: [1, 0.9, 1.15, 1],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2
        }}
      />

      <motion.div
        className="absolute w-[450px] h-[450px] rounded-full bg-blue-400/12 blur-3xl"
        style={{ bottom: '15%', left: '30%' }}
        animate={{
          x: [0, 40, -30, 0],
          y: [0, -30, 40, 0],
          scale: [1, 1.2, 0.85, 1],
          rotate: [0, 90, 180, 270, 360]
        }}
        transition={{
          duration: 30,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 5
        }}
      />
    </div>
  );
}
