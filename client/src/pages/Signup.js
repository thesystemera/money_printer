import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Box, VStack, Text, Input, Button, Alert, AlertIcon,
  FormControl, FormLabel, Divider, useColorMode, Flex, Image
} from '@chakra-ui/react';
import { useAuth } from '../contexts/AuthContext';

// Import processed assets
import moneyPrinterLogo from '../assets/logo.png';
import backgroundImage from '../assets/background.webp';
import signupLayerImage from '../assets/layer-signup.png'; // <-- Layer for the form background

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const { signup } = useAuth();
  const navigate = useNavigate();
  const { colorMode } = useColorMode();

  async function handleSubmit(e) {
    e.preventDefault();

    if (password !== confirmPassword) {
      return setError('Passwords do not match. Please try again.');
    }
    if (password.length < 6) {
      return setError('Password must be at least 6 characters for security.');
    }

    try {
      setError('');
      setSuccess('');
      setLoading(true);
      await signup(email, password);
      setSuccess('Account created. A verification email has been sent to your address. Please check your inbox to continue.');
      setTimeout(() => {
        navigate('/login');
      }, 5000);
    } catch (error) {
      let errorMessage = 'Unable to create account. Please try again.';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'An account already exists with this email. Please sign in instead.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Please choose a stronger password (at least 6 characters).';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Flex
      minHeight="100vh"
      width="full"
      align="center"
      justifyContent="center"
      bgImage={`url(${backgroundImage})`}
      bgPosition="center"
      bgRepeat="no-repeat"
      bgSize="cover"
      position="relative"
      overflow="hidden"
    >
      <Box
        maxW="md"
        w="full"
        bg={colorMode === 'dark' ? 'gray.800' : 'white'}
        bgImage={`url(${signupLayerImage})`}
        bgBlendMode="overlay"
        bgPosition="center"
        bgSize="cover"
        p={8}
        borderRadius="lg"
        boxShadow="xl"
        position="relative"
      >
        <VStack spacing={6}>
          <Box textAlign="center">
            <Image src={moneyPrinterLogo} alt="MONEY PRINTER Logo" maxW="180px" mx="auto" mb={4} />
            <Text color={colorMode === 'dark' ? 'gray.300' : 'gray.600'}>
              Bloomberg grade analytics for your mum!
            </Text>
            <Text fontSize="sm" color="gold" mt={2} fontWeight="bold">
              VIP Access Request
            </Text>
          </Box>

          {error && (
            <Alert status="error" variant="subtle">
              <AlertIcon />
              <Text fontSize="sm">{error}</Text>
            </Alert>
          )}

          {success && (
            <Alert status="success" variant="subtle">
              <AlertIcon />
              <Text fontSize="sm">{success}</Text>
            </Alert>
          )}

          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel>Email Address</FormLabel>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@address.com"
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Password</FormLabel>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Confirm Password</FormLabel>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                />
              </FormControl>

              <Button
                type="submit"
                colorScheme="blue"
                size="lg"
                w="full"
                isLoading={loading}
                loadingText="Creating Account..."
              >
                Request Access
              </Button>
            </VStack>
          </form>

          <Divider />

          <Text textAlign="center" color={colorMode === 'dark' ? 'gray.400' : 'gray.600'}>
            Already have an account?{' '}
            <Link to="/login">
              <Text as="span" color="blue.400" _hover={{ textDecoration: 'underline' }}>
                Sign In Here
              </Text>
            </Link>
          </Text>
        </VStack>
      </Box>
    </Flex>
  );
}