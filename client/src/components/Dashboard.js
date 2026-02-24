        import React from 'react';
        import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
        import { ChakraProvider, extendTheme } from '@chakra-ui/react';
        import PrivateRoute from './PrivateRoute';
        import DashboardContent from './DashboardContent';
        import Login from '../pages/Login';
        import Signup from '../pages/Signup';
        import { UI_THEME } from '../config/Config';

        const theme = extendTheme(UI_THEME);

        function Dashboard() {
          return (
            <ChakraProvider theme={theme}>
              <Router>
                <Routes>
                  <Route
                    path="/"
                    element={
                      <PrivateRoute>
                        <DashboardContent />
                      </PrivateRoute>
                    }
                  />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/login" element={<Login />} />
                </Routes>
              </Router>
            </ChakraProvider>
          );
        }

        export default Dashboard;