import React from 'react';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  Button,
  Text,
  VStack,
} from '@chakra-ui/react';
import { AlertTriangle, Lock } from 'lucide-react';
import * as TimeService from '../services/timeService';
import { useAuth } from '../contexts/AuthContext';

export const checkReprocessConfirmation = (lastAnalyzedISO, userTier) => {
  const warnings = [];
  const now = TimeService.getCurrentTime();
  const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const isAdmin = userTier === 'admin';

  if (lastAnalyzedISO) {
    const lastAnalyzed = new Date(lastAnalyzedISO);
    const hoursSinceLastAnalysis = (now.getTime() - lastAnalyzed.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastAnalysis < 1) {
      warnings.push(`This stock was already analyzed within the last hour (${lastAnalyzed.toLocaleTimeString()}).`);
    }
  }

  const dayOfWeek = easternTime.getDay();
  const hourOfDay = easternTime.getHours();

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isOutsideHours = hourOfDay < 2 || hourOfDay >= 10;

  if (isWeekend) {
    warnings.push("The market is currently closed for the weekend.");
  } else if (isOutsideHours) {
    warnings.push("Analysis is typically run between 2 AM and 10 AM Eastern Time for optimal data.");
  }

  const hasTimeWarning = isWeekend || isOutsideHours;
  let isPermissionError = false;

  if (hasTimeWarning) {
    if (isAdmin) {
      warnings.push("As an administrator, you can override this time restriction.");
    } else {
      warnings.push("Only administrators can run analysis outside of the standard 2 AM - 10 AM ET window.");
      isPermissionError = true;
    }
  }

  if (userTier === 'premium' && warnings.length > 0 && !isPermissionError) {
      warnings.push("Re-analyzing a recent stock is an admin-only feature.");
      isPermissionError = true;
  }


  return {
    needsConfirmation: warnings.length > 0,
    warnings,
    isPermissionError,
  };
};

const ReprocessConfirmationDialog = ({ isOpen, onClose, onConfirm, warnings, isPermissionError }) => {
  const cancelRef = React.useRef();
  const Icon = isPermissionError ? Lock : AlertTriangle;
  const iconColor = isPermissionError ? "#4299E1" : "#DD6B20";
  const title = isPermissionError ? "Permission Denied" : "Confirm Re-analysis";

  return (
    <AlertDialog
      isOpen={isOpen}
      leastDestructiveRef={cancelRef}
      onClose={onClose}
      isCentered
    >
      <AlertDialogOverlay>
        <AlertDialogContent mx="4" borderRadius="lg">
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            <VStack>
                <Icon size={48} color={iconColor} />
                <Text>{title}</Text>
            </VStack>
          </AlertDialogHeader>

          <AlertDialogBody>
            <VStack spacing={3}>
              {warnings.map((warning, index) => (
                <Text key={index} textAlign="center">{warning}</Text>
              ))}
              {!isPermissionError && (
                <Text fontWeight="semibold" pt="2">Are you sure you want to proceed?</Text>
              )}
            </VStack>
          </AlertDialogBody>

          <AlertDialogFooter>
            <Button ref={cancelRef} onClick={onClose}>
              {isPermissionError ? "Close" : "Cancel"}
            </Button>
            {!isPermissionError && (
              <Button colorScheme="orange" onClick={onConfirm} ml={3}>
                Proceed
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
};

export default ReprocessConfirmationDialog;
