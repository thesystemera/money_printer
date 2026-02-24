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
import loginLayerImage from '../assets/layer-login.png'; // <-- Layer for the form background

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { colorMode } = useColorMode();

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);
      await login(email, password);
      navigate('/');
    } catch (error) {
      let errorMessage = 'Unable to sign in. Please check your credentials and try again.';
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email. Need access? Click "Request Invitation" below.';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password. Please try again or reset your password if needed.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Access temporarily disabled due to too many login attempts. Please try again later.';
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
        // --- THIS IS THE UPDATED PART ---
        bg={colorMode === 'dark' ? 'gray.800' : 'white'}
        bgImage={`url(${loginLayerImage})`}
        bgBlendMode="overlay" // Blends the layer with the background color
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
              VIP Members Only
            </Text>
          </Box>

          {error && (
            <Alert status="error" variant="subtle">
              <AlertIcon />
              <Text fontSize="sm">{error}</Text>
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
                  placeholder="your.vip.email@address.com"
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Password</FormLabel>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                />
              </FormControl>

              <Button
                type="submit"
                colorScheme="blue"
                size="lg"
                w="full"
                isLoading={loading}
                loadingText="Authenticating..."
              >
                Sign In
              </Button>
            </VStack>
          </form>

          <Divider />

          <Text textAlign="center" color={colorMode === 'dark' ? 'gray.400' : 'gray.600'}>
            New to MONEY PRINTER?{' '}
            <Link to="/signup">
              <Text as="span" color="blue.400" _hover={{ textDecoration: 'underline' }}>
                Request VIP Invitation
              </Text>
            </Link>
          </Text>
        </VStack>
      </Box>
    </Flex>
  );
}