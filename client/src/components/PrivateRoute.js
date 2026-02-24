import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, VStack, Heading, Text, Button, Alert, AlertIcon, AlertTitle, AlertDescription } from '@chakra-ui/react';
import { useAuth } from '../contexts/AuthContext';

export default function PrivateRoute({ children }) {
  const { currentUser, needsVerification, sendVerificationEmail, reloadUser } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (needsVerification) {
    return (
      <Box
        minH="100vh"
        bg="gray.900"
        display="flex"
        alignItems="center"
        justifyContent="center"
        p={4}
      >
        <Box maxW="md" w="full" textAlign="center">
          <VStack spacing={6}>
            <Heading color="blue.400" size="xl">
              🎯 MONEY PRINTER
            </Heading>

            <Alert status="info" variant="subtle">
              <AlertIcon />
              <Box>
                <AlertTitle>📧 Email Verification Required</AlertTitle>
                <AlertDescription>
                  Almost there! Please check your inbox and click the verification link we sent you.
                </AlertDescription>
              </Box>
            </Alert>

            <Text color="gray.300" textAlign="center">
              Verification email sent to:<br />
              <Text as="span" fontWeight="bold" color="white">
                {currentUser?.email}
              </Text>
            </Text>

            <VStack spacing={3}>
              <Button
                colorScheme="blue"
                onClick={reloadUser}
                size="lg"
              >
                ✅ I've Verified - Continue
              </Button>

              <Button
                variant="outline"
                onClick={sendVerificationEmail}
                size="sm"
              >
                📧 Resend Verification Email
              </Button>
            </VStack>

            <Text fontSize="sm" color="gray.500">
              💡 Can't find the email? Check your spam/junk folder!
            </Text>
          </VStack>
        </Box>
      </Box>
    );
  }

  return children;
}