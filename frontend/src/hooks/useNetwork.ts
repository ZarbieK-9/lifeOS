// Network monitoring — SYSTEM.md §5: queue locally when offline
// Drives offline banner + queue drain on reconnect + MQTT reconnect

import { useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useStore } from '../store/useStore';

export function useNetwork() {
  const setOnline = useStore(s => s.setOnline);
  const drainQueue = useStore(s => s.drainQueue);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const { isOnline } = useStore.getState();
      if (isOnline) {
        drainQueue().catch(() => {});
      }
    }, 60 * 1000);

    const unsub = NetInfo.addEventListener(state => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setOnline(online);
      if (online) {
        // Drain offline queue
        drainQueue();

        // Reconnect MQTT if backend is configured
        const { isBackendConfigured, isAuthenticated } = useStore.getState();
        if (isBackendConfigured && isAuthenticated) {
          import('../services/mqtt').then(({ mqttService }) => {
            if (!mqttService.isConnected()) {
              mqttService.connect();
            }
          }).catch(() => {});
        }
      }
    });
    return () => {
      clearInterval(intervalId);
      unsub();
    };
  }, [setOnline, drainQueue]);
}
