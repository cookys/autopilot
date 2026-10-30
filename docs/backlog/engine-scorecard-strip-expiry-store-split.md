# engine-scorecard strip-expiry silently writes the real engine-capability store when only one directory is overridden (BL-0339)

Peer message 01M67HZPT918GAWJG237T0JG8N. Subagent run on a copy rewrote real evidence and pins; restored from backup.

Fix direction: refuse when only one of the two dirs is overridden, or list every path about to be written before writing. Add a negative control (one override only must be refused).
