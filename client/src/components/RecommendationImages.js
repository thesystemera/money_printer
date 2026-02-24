import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Box, Text, SimpleGrid, Image, Modal, ModalOverlay, ModalContent, ModalBody,
  ModalCloseButton, useDisclosure, Flex, IconButton, Button, useColorMode
} from '@chakra-ui/react';
import {
  Image as ImageIcon, Maximize2, BarChart2, TrendingUp, History, AlertCircle, ZoomIn, ZoomOut, RotateCcw,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { PanelContainer } from './RecommendationComponents';

const getCategoryIcon = (category) => {
  const iconMap = {
    'SENTIMENT_TEMPORAL': BarChart2, 'SENTIMENT_COMBINED': BarChart2, 'SENTIMENT_RECENT': BarChart2,
    'OPTIONS_ANALYSIS': AlertCircle, 'PREDICTION_HISTORY': History
  };
  return iconMap[category] || TrendingUp;
};

const getCategoryColor = (category) => {
  const colorMap = {
    'SENTIMENT_TEMPORAL': 'purple', 'SENTIMENT_COMBINED': 'purple', 'SENTIMENT_RECENT': 'purple',
    'OPTIONS_ANALYSIS': 'blue', 'PREDICTION_HISTORY': 'orange'
  };
  return colorMap[category] || 'gray';
};

const getCategoryDisplayName = (category) => {
  const nameMap = {
    'SENTIMENT_TEMPORAL': 'Sentiment Timeline', 'SENTIMENT_COMBINED': 'Combined Sentiment',
    'SENTIMENT_RECENT': 'Recent Sentiment', 'OPTIONS_ANALYSIS': 'Options Analysis', 'PREDICTION_HISTORY': 'Prediction History'
  };
  return nameMap[category] || category.replace('_', ' ');
};

const ImageCard = ({ image, onClick }) => {
  const { colorMode } = useColorMode();
  const CategoryIcon = getCategoryIcon(image.category);
  const categoryColor = getCategoryColor(image.category);
  const categoryName = getCategoryDisplayName(image.category);

  return (
    <Box
      position="relative"
      borderRadius="lg"
      overflow="hidden"
      cursor="pointer"
      onClick={onClick}
      height="300px"
      _hover={{
        transform: 'scale(1.02)',
        transition: 'all 0.3s ease',
        '& .overlay': {
          opacity: 1
        }
      }}
      transition="all 0.3s ease"
      boxShadow="lg"
    >
      <Image
        src={image.data}
        alt={categoryName}
        width="100%"
        height="100%"
        objectFit="cover"
        fallback={
          <Flex height="100%" align="center" justifyContent="center" bg={colorMode === 'dark' ? 'gray.700' : 'gray.100'}>
            <ImageIcon size={32} color="gray" />
          </Flex>
        }
      />
      <Box
        className="overlay"
        position="absolute"
        top={0} left={0} right={0} bottom={0}
        bg="blackAlpha.700"
        opacity={0}
        transition="opacity 0.3s ease"
        display="flex"
        flexDirection="column"
        justifyContent="space-between"
        p={4}
      >
        <Flex justify="space-between" align="flex-start">
          <Flex align="center" bg="whiteAlpha.900" borderRadius="md" p={2}>
            <CategoryIcon size={16} color={`var(--chakra-colors-${categoryColor}-500)`} />
            <Text fontSize="sm" fontWeight="bold" ml={2} color="black">{categoryName}</Text>
          </Flex>
          <IconButton
            aria-label="Expand image"
            icon={<Maximize2 size={16} />}
            size="sm"
            variant="solid"
            colorScheme={categoryColor}
            bg="whiteAlpha.900"
            color="black"
            _hover={{ bg: 'white' }}
          />
        </Flex>
      </Box>
    </Box>
  );
};

const RecommendationImages = ({ images, isOpen, onToggle, borderColor, companySymbol }) => {
  const { isOpen: isModalOpen, onOpen: onModalOpen, onClose: onModalClose } = useDisclosure();
  const [currentIndex, setCurrentIndex] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const { colorMode } = useColorMode();

  const sortedImages = useMemo(() => {
    if (!images || images.length === 0) return [];
    return [...images].sort((a, b) => (a.index || 0) - (b.index || 0));
  }, [images]);

  const showNextImage = useCallback(() => {
    if (currentIndex === null) return;
    const nextIndex = (currentIndex + 1) % sortedImages.length;
    setCurrentIndex(nextIndex);
    resetView();
  }, [currentIndex, sortedImages.length]);

  const showPrevImage = useCallback(() => {
    if (currentIndex === null) return;
    const prevIndex = (currentIndex - 1 + sortedImages.length) % sortedImages.length;
    setCurrentIndex(prevIndex);
    resetView();
  }, [currentIndex, sortedImages.length]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isModalOpen) return;
      if (e.key === 'ArrowRight') showNextImage();
      if (e.key === 'ArrowLeft') showPrevImage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, showNextImage, showPrevImage]);

  const handleImageClick = (index) => {
    setCurrentIndex(index);
    resetView();
    onModalOpen();
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const zoomIntensity = 0.1;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -1 : 1;
    const newZoom = Math.min(Math.max(0.5, zoom * (1 + delta * zoomIntensity)), 5);

    const newPanX = pan.x - (mouseX - pan.x) * ((newZoom / zoom) - 1);
    const newPanY = pan.y - (mouseY - pan.y) * ((newZoom / zoom) - 1);

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan]);

  const handleZoomIn = () => setZoom(prevZoom => Math.min(prevZoom + 0.2, 5));
  const handleZoomOut = () => setZoom(prevZoom => Math.max(prevZoom - 0.2, 0.5));

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (!images || images.length === 0) {
    return null;
  }

  const selectedImage = currentIndex !== null ? sortedImages[currentIndex] : null;

  return (
    <>
      <PanelContainer
        title={`Analysis Charts (${images.length})`}
        icon={ImageIcon}
        iconColor="green.500"
        isExpanded={isOpen}
        onToggleExpand={onToggle}
        borderColor={borderColor}
      >
        <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4, xl: 5 }} spacing={4} minChildWidth="250px">
          {sortedImages.map((image, idx) => (
            <ImageCard
              key={`image-${idx}-${image.index}`}
              image={image}
              onClick={() => handleImageClick(idx)}
            />
          ))}
        </SimpleGrid>
        <Text fontSize="xs" color="gray.500" mt={6} textAlign="center">
          Click any image to view full size • Generated for {companySymbol}
        </Text>
      </PanelContainer>

      <Modal isOpen={isModalOpen} onClose={onModalClose} size="full">
        <ModalOverlay bg="blackAlpha.900" />
        <ModalContent bg="transparent" boxShadow="none" onWheel={handleWheel}>
          <ModalCloseButton
            zIndex={20} color="white" bg="blackAlpha.700"
            _hover={{ bg: "blackAlpha.800" }} size="lg" top={4} right={4}
          />
          <ModalBody
            p={0} display="flex" alignItems="center" justifyContent="center"
            onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            overflow="hidden"
          >
            <IconButton
              aria-label="Previous image"
              icon={<ChevronLeft size={32} />}
              position="absolute"
              left="20px"
              top="50%"
              transform="translateY(-50%)"
              zIndex={15}
              onClick={showPrevImage}
              variant="ghost"
              color="white"
              bg="blackAlpha.500"
              _hover={{ bg: 'blackAlpha.700' }}
              isRound
              size="lg"
            />

            {selectedImage && (
              <>
                <Box
                    ref={imageRef}
                    onMouseDown={handleMouseDown}
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'top left',
                        cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                        userSelect: 'none',
                        maxWidth: '95vw',
                        maxHeight: '95vh'
                    }}
                >
                    <Image
                        src={selectedImage.data}
                        alt={getCategoryDisplayName(selectedImage.category)}
                        borderRadius="md"
                        boxShadow="2xl"
                        draggable="false"
                        fallback={
                            <Flex width="80vw" height="80vh" align="center" justifyContent="center" bg={colorMode === 'dark' ? 'gray.800' : 'gray.100'} borderRadius="lg">
                            <ImageIcon size={64} color="gray" />
                            <Text ml={4} color="gray.500" fontSize="xl">Failed to load image</Text>
                            </Flex>
                        }
                    />
                </Box>
                <Flex
                  position="absolute" bottom="30px" left="50%" transform="translateX(-50%)" gap={2}
                  zIndex={10} bg="blackAlpha.800" p={2} borderRadius="lg" alignItems="center" boxShadow="lg"
                >
                  <IconButton aria-label="Zoom out" icon={<ZoomOut size={20} />} onClick={handleZoomOut} size="md" color="white" variant="ghost" _hover={{ bg: 'whiteAlpha.200' }} isDisabled={zoom <= 0.5}/>
                  <Text color="white" fontSize="md" fontWeight="bold" w="100px" textAlign="center">{Math.round(zoom * 100)}%</Text>
                  <IconButton aria-label="Zoom in" icon={<ZoomIn size={20} />} onClick={handleZoomIn} size="md" color="white" variant="ghost" _hover={{ bg: 'whiteAlpha.200' }} isDisabled={zoom >= 5}/>
                  <Button leftIcon={<RotateCcw size={16} />} size="md" color="white" variant="ghost" onClick={resetView} _hover={{ bg: 'whiteAlpha.200' }} ml={2}>Reset</Button>
                </Flex>
              </>
            )}

            <IconButton
              aria-label="Next image"
              icon={<ChevronRight size={32} />}
              position="absolute"
              right="20px"
              top="50%"
              transform="translateY(-50%)"
              zIndex={15}
              onClick={showNextImage}
              variant="ghost"
              color="white"
              bg="blackAlpha.500"
              _hover={{ bg: 'blackAlpha.700' }}
              isRound
              size="lg"
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};

export default RecommendationImages;